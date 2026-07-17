// /api/chat —— 对话
//
// 两条路径，按 Agent 类型分流：
//   · advisor（responseMode: structured）→ 非流式，返回 JSON 裁决报告（要完整 JSON 才能解析校验）
//   · 其余 Agent → SSE 流式，支持工具调用循环，末尾剥离 handoff 标记
//
// 运行时注入 skills / agentLinks / schedule，并解析 handoff。

import { getAgent, listAgents } from "./_store.js";
import {
  parseFeasibilityReport,
  buildFeasibilitySummary,
  ensureJsonHintInMessages,
} from "./_feasibility.js";
import {
  buildRuntimeSystem,
  parseHandoffMarker,
  parseHandoffFromRawJson,
  splitStreamSafe,
} from "./_runtime.js";
import { enforceRateLimit } from "./_ratelimit.js";
import { buildToolDefinitions, describeTool, executeTool } from "./_tools.js";
import { recordChat } from "./_metrics.js";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/**
 * 是否走结构化裁决模式
 * @param {object} agent
 */
function isStructuredAdvisor(agent) {
  return agent?.responseMode === "structured" || agent?.id === "advisor";
}

/**
 * 调用 DashScope 聊天接口（非流式）
 * @param {string} apiKey
 * @param {object} payload
 * @param {{tokens:number}} [usageBox] - 传入则累加本次 total_tokens，用于埋点
 */
async function callDashScope(apiKey, payload, usageBox) {
  const resp = await fetch(DASHSCOPE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`模型接口报错: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (usageBox && data.usage) {
    usageBox.tokens += Number(data.usage.total_tokens) || 0;
  }
  return data.choices?.[0]?.message?.content || "";
}

/**
 * 流式调用 DashScope，逐个 yield choice（含 delta 与 finish_reason）。
 * DashScope 兼容模式走 OpenAI 的 SSE 格式：每行 `data: {...}`，以 `data: [DONE]` 收尾。
 * @param {string} apiKey
 * @param {object} payload
 * @param {{tokens:number}} [usageBox] - 传入则把最后一帧的 total_tokens 写回，用于埋点
 * @returns {AsyncGenerator<object>}
 */
async function* streamDashScope(apiKey, payload, usageBox) {
  const resp = await fetch(DASHSCOPE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    // include_usage：末尾多一帧 choices 为空、带 usage 的 chunk，用于统计 token
    body: JSON.stringify({
      ...payload,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`模型接口报错: ${errText.slice(0, 200)}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of resp.body) {
    buffer += decoder.decode(chunk, { stream: true });

    // SSE 以空行分隔事件；最后一段可能不完整，留在 buffer 里等下一块
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payloadStr = trimmed.slice(5).trim();
      if (payloadStr === "[DONE]") return;

      try {
        const parsed = JSON.parse(payloadStr);
        if (usageBox && parsed.usage) {
          usageBox.tokens = Number(parsed.usage.total_tokens) || usageBox.tokens;
        }
        const choice = parsed.choices?.[0];
        if (choice) yield choice;
      } catch {
        /* 保活注释或半截 JSON，跳过 */
      }
    }
  }
}

/**
 * 把流式到达的 tool_calls 分片按 index 合并。
 * 工具名通常在首片给全，arguments 则是一串 JSON 碎片，要按序拼接。
 * @param {object[]} acc - 累积数组（原地修改）
 * @param {object[]} deltas
 */
function accumulateToolCalls(acc, deltas) {
  for (const d of deltas) {
    const i = d.index ?? 0;
    if (!acc[i]) acc[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
    if (d.id) acc[i].id = d.id;
    if (d.function?.name) acc[i].function.name = d.function.name;
    if (d.function?.arguments) acc[i].function.arguments += d.function.arguments;
  }
}

/**
 * 跑一轮流式对话：正文增量实时回调，tool_calls 累积后返回。
 * @param {string} apiKey
 * @param {object} payload
 * @param {(text:string)=>void} onContent
 * @returns {Promise<{ content: string, toolCalls: object[], tokens: number }>}
 */
async function streamRound(apiKey, payload, onContent) {
  const toolCalls = [];
  const usageBox = { tokens: 0 };
  let content = "";

  for await (const choice of streamDashScope(apiKey, payload, usageBox)) {
    const delta = choice.delta || {};
    if (delta.content) {
      content += delta.content;
      onContent(delta.content);
    }
    if (delta.tool_calls) accumulateToolCalls(toolCalls, delta.tool_calls);
  }

  return { content, toolCalls: toolCalls.filter(Boolean), tokens: usageBox.tokens };
}

/**
 * 建立 SSE 响应通道
 * @param {import('http').ServerResponse} res
 */
function openSseChannel(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // 禁止代理缓冲，否则「流式」会变成一次性吐出
  });
  return (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** 工具调用最多来回几轮，防止模型陷进循环把函数跑超时 */
const MAX_TOOL_ROUNDS = 4;

/**
 * 流式对话 + 工具调用循环。
 *
 * 每轮都是流式的：模型直接答就实时逐字下发；模型要调工具，则本轮只会累出 tool_calls，
 * 执行完把结果塞回 messages 再开下一轮。正文跨轮累积，末尾统一剥离 handoff 标记。
 *
 * @param {import('http').ServerResponse} res
 * @param {string} apiKey
 * @param {object} payload
 * @param {object} agent
 * @param {object} toolCtx - 传给工具的运行时上下文
 */
async function handleStreamingChat(res, apiKey, payload, agent, toolCtx) {
  const send = openSseChannel(res);
  const tools = buildToolDefinitions(agent.skills);
  const messages = [...payload.messages];

  let raw = "";
  let held = "";
  let emittedLen = 0;
  let totalTokens = 0; // 跨轮累加（每轮 LLM 调用都算）
  let totalToolCalls = 0;

  /** 下发正文增量，同时扣住可能构成 handoff 标记的尾巴 */
  const emit = (text) => {
    raw += text;
    const [safe, tail] = splitStreamSafe(held + text);
    held = tail;
    if (safe) {
      send({ type: "delta", text: safe });
      emittedLen += safe.length;
    }
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const roundPayload = { ...payload, messages };
      if (tools.length) {
        roundPayload.tools = tools;
        roundPayload.parallel_tool_calls = true;
      }

      const { content, toolCalls, tokens } = await streamRound(apiKey, roundPayload, emit);
      totalTokens += tokens;

      if (!toolCalls.length) break; // 模型给出最终答复

      // 记下模型的工具调用意图，再逐个执行并回填结果
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        totalToolCalls += 1;
        const meta = describeTool(agent.skills, call.function.name);
        send({ type: "status", tool: call.function.name, label: meta.name, icon: meta.icon });

        const result = await executeTool(call.function.name, call.function.arguments, toolCtx);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      if (round === MAX_TOOL_ROUNDS - 1) {
        // 轮次耗尽仍在调工具：再要一次纯文本收口，避免用户拿到空回复
        const final = await streamRound(apiKey, { ...payload, messages }, emit);
        totalTokens += final.tokens;
        if (!final.content.trim()) emit("(工具调用未能收敛，请换个说法再试)");
      }
    }

    // 收尾：剥离 handoff 标记，把扣住但属于正文的部分补发
    const { reply: cleaned, handoff } = parseHandoffMarker(raw, agent.agentLinks);
    const remainder = cleaned.slice(emittedLen);
    if (remainder) send({ type: "delta", text: remainder });

    if (!cleaned.trim()) {
      send({ type: "delta", text: "(模型没有返回内容,请重试)" });
    }
    if (handoff) send({ type: "handoff", handoff });
    send({ type: "done" });

    // 埋点：不 await，也不让它的失败影响已完成的响应
    recordChat(
      { tokens: totalTokens, toolCalls: totalToolCalls, handoff: !!handoff },
      toolCtx?.tzOffset
    ).catch(() => {});
  } catch (err) {
    // 已发过 header，只能在流内报错
    send({ type: "error", error: `服务端异常: ${err.message}` });
  } finally {
    res.end();
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "服务端未配置 API key(请在 Vercel 环境变量设置 DASHSCOPE_API_KEY)",
    });
  }

  if (!(await enforceRateLimit(req, res))) return;

  try {
    const { agentId, messages, clientTime, tzOffset } = req.body || {};
    const agent = await getAgent(agentId);
    if (!agent) return res.status(400).json({ error: "未找到该 Agent" });
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages 必须是数组" });
    }

    const { agents: allAgents } = await listAgents();
    const temperature =
      typeof agent.temperature === "number" ? agent.temperature : 0.6;
    const structured = isStructuredAdvisor(agent);

    const systemContent = buildRuntimeSystem(agent, {
      clientTime,
      tzOffset: typeof tzOffset === "number" ? tzOffset : undefined,
      allAgents,
      structured,
    });

    const payload = {
      model: "qwen-plus",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
    };

    // 非结构化 Agent 走流式：等十几秒看打字动画的体感，是这个项目最大的观感短板。
    // advisor 需要完整 JSON 才能解析校验，仍走非流式。
    if (!structured) {
      const toolCtx = {
        clientTime,
        tzOffset: typeof tzOffset === "number" ? tzOffset : undefined,
        allAgents,
      };
      return await handleStreamingChat(res, apiKey, payload, agent, toolCtx);
    }

    payload.messages = ensureJsonHintInMessages(payload.messages);
    payload.response_format = { type: "json_object" };

    const usageBox = { tokens: 0 }; // 累加裁决路径上多次调用的 token
    let raw = await callDashScope(apiKey, payload, usageBox);
    let report = structured ? parseFeasibilityReport(raw) : null;

    // JSON 解析失败时重试一次
    if (structured && !report) {
      const retryPayload = {
        ...payload,
        messages: [
          ...payload.messages,
          {
            role: "user",
            content:
              "请严格按 system 要求，只输出合法 JSON 对象，不要 Markdown 或解释文字。",
          },
        ],
      };
      raw = await callDashScope(apiKey, retryPayload, usageBox);
      report = parseFeasibilityReport(raw);
    }

    // 解析成功但质量不足（六维同分或 reason 大量为空）时再重试一次
    if (structured && report?.lowQuality) {
      const qualityRetryPayload = {
        ...payload,
        messages: [
          ...payload.messages,
          {
            role: "user",
            content:
              "上次输出质量不合格：六维得分不应全部相同，每个 dimension 的 reason 必须 20–50 字且结合用户场景，summary 不得复读 verdictLabel，gate1/gate2.summary 必填，risks/alternatives/nextSteps 至少一类≥2条。请重新输出完整 JSON。",
          },
        ],
      };
      const retryRaw = await callDashScope(apiKey, qualityRetryPayload, usageBox);
      const retryReport = parseFeasibilityReport(retryRaw);
      if (retryReport && !retryReport.lowQuality) {
        raw = retryRaw;
        report = retryReport;
      } else if (retryReport) {
        const prevEmpty = (report.gate1.dimensions.concat(report.gate2.dimensions))
          .filter((d) => !d.reason).length;
        const nextEmpty = (retryReport.gate1.dimensions.concat(retryReport.gate2.dimensions))
          .filter((d) => !d.reason).length;
        if (nextEmpty < prevEmpty) {
          raw = retryRaw;
          report = retryReport;
        }
      }
    }

    if (structured && report) {
      const handoff = parseHandoffFromRawJson(raw, agent.agentLinks);
      const body = {
        reply: buildFeasibilitySummary(report),
        structured: report,
      };
      if (handoff) body.handoff = handoff;
      recordChat(
        { tokens: usageBox.tokens, handoff: !!handoff, verdict: report.verdict },
        typeof tzOffset === "number" ? tzOffset : undefined
      ).catch(() => {});
      return res.status(200).json(body);
    }

    const { reply: cleanedReply, handoff } = parseHandoffMarker(raw, agent.agentLinks);
    const reply = (cleanedReply && String(cleanedReply).trim()) || "(模型没有返回内容,请重试)";

    const body = { reply };
    if (handoff) body.handoff = handoff;
    recordChat(
      { tokens: usageBox.tokens, handoff: !!handoff },
      typeof tzOffset === "number" ? tzOffset : undefined
    ).catch(() => {});
    return res.status(200).json(body);
  } catch (err) {
    return res.status(500).json({ error: `服务端异常: ${err.message}` });
  }
}
