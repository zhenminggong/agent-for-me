// /api/chat —— 对话
// advisor Agent 返回结构化 JSON 裁决报告；其他 Agent 仍为纯文本。

import { getAgent } from "./_store.js";
import {
  parseFeasibilityReport,
  buildFeasibilitySummary,
} from "./_feasibility.js";

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
 * 调用 DashScope 聊天接口
 * @param {object} params
 */
async function callDashScope(apiKey, payload) {
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
  return data.choices?.[0]?.message?.content || "";
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

  try {
    const { agentId, messages } = req.body || {};
    const agent = await getAgent(agentId);
    if (!agent) return res.status(400).json({ error: "未找到该 Agent" });
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages 必须是数组" });
    }

    const temperature =
      typeof agent.temperature === "number" ? agent.temperature : 0.6;
    const structured = isStructuredAdvisor(agent);

    const payload = {
      model: "qwen-plus",
      messages: [{ role: "system", content: agent.system }, ...messages],
      temperature,
    };

    if (structured) {
      payload.response_format = { type: "json_object" };
    }

    let raw = await callDashScope(apiKey, payload);
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
      raw = await callDashScope(apiKey, retryPayload);
      report = parseFeasibilityReport(raw);
    }

    if (structured && report) {
      return res.status(200).json({
        reply: buildFeasibilitySummary(report),
        structured: report,
      });
    }

    const reply = (raw && String(raw).trim()) || "(模型没有返回内容,请重试)";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: `服务端异常: ${err.message}` });
  }
}
