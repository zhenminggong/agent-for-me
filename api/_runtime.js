/**
 * Agent 运行时能力注入：skills、handoff、schedule
 * 供 /api/chat 拼接到 system prompt，并解析 LLM 输出的 handoff 标记。
 */

/** handoff 文本标记：[HANDOFF:targetId:reason] */
const HANDOFF_MARKER_RE = /\[HANDOFF:([^:\]\s]+):([^\]]*)\]\s*$/m;

/**
 * 格式化技能列表为 system 补充段
 * @param {Array<{icon?:string, name:string, desc?:string}>|undefined} skills
 * @returns {string}
 */
export function buildSkillsSupplement(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "";

  const format = (s) => {
    const icon = s.icon || "✦";
    const name = s.name || s.id || "未命名技能";
    const desc = s.desc ? `: ${s.desc}` : "";
    // 真工具标注对应的函数名，模型才知道这项技能该用哪个 function 兑现
    const bind = s.tool ? `（可调用函数 \`${s.tool}\`）` : "";
    return `- ${icon} ${name}${desc}${bind}`;
  };

  const executable = skills.filter((s) => s.tool);
  const promptOnly = skills.filter((s) => !s.tool);

  const lines = ["## 你可用的技能"];

  if (executable.length) {
    lines.push(
      "",
      "### 可执行工具（真实调用，结果可信）",
      ...executable.map(format),
      "",
      "涉及这些能力时必须实际调用对应函数拿真实结果，不要凭记忆或推测作答。"
    );
  }

  if (promptOnly.length) {
    lines.push("");
    if (executable.length) lines.push("### 行事风格技能");
    lines.push(...promptOnly.map(format));
  }

  lines.push("", "请在回复中主动运用上述技能；必要时简要说明正在使用哪项技能。");
  return lines.join("\n");
}

/**
 * 格式化 agentLinks 与 handoff 规则
 * @param {Array<{targetId:string, label?:string, trigger?:string}>|undefined} agentLinks
 * @param {Array<{id:string, name?:string}>} allAgents
 * @param {boolean} structured - 是否为 JSON 结构化输出模式
 * @returns {string}
 */
export function buildHandoffSupplement(agentLinks, allAgents = [], structured = false) {
  if (!Array.isArray(agentLinks) || agentLinks.length === 0) return "";

  const resolveName = (id) =>
    allAgents.find((a) => a.id === id)?.name || id;

  const lines = agentLinks.map((link) => {
    const targetName = resolveName(link.targetId);
    const label = link.label || `转交 ${targetName}`;
    const trigger = link.trigger ? `（${link.trigger}）` : "";
    return `- **${label}** → \`${link.targetId}\`（${targetName}）${trigger}`;
  });

  const intro = [
    "## 可协作转交的 Agent",
    "当用户场景更适合其他 Agent 处理时，应主动建议转交：",
    ...lines,
    "",
  ];

  if (structured) {
    intro.push(
      "若需要转交，在 JSON 根对象增加可选字段（仅在有明确转交必要时填写）：",
      '  "handoff": { "targetId": "目标agentId", "reason": "转交原因，一句话" }',
      "handoff.targetId 必须是上表中的 agentId；不需要转交时不要输出 handoff 字段。"
    );
  } else {
    intro.push(
      "若需要转交，在回复正文末尾单独一行输出（用户不可见，系统会解析并移除）：",
      "  [HANDOFF:目标agentId:转交原因]",
      "targetId 必须是上表中的 agentId；不需要转交时不要输出该标记。"
    );
  }

  return intro.join("\n");
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * 由「墙上时钟」字段构造时间信息。
 * 全程不碰 Date 的本地时区取值器，因此不受服务端时区（Vercel 为 UTC）影响。
 * @param {{year?:number, month?:number, day?:number, hour:number, minute:number}} f
 * @returns {{ timeStr: string, dateStr: string, minutes: number }}
 */
function makeTimeInfo({ year, month, day, hour, minute }) {
  const timeStr = `${pad2(hour)}:${pad2(minute)}`;
  const dateStr = year
    ? `${year}-${pad2(month)}-${pad2(day)} ${timeStr}`
    : timeStr;
  return { timeStr, dateStr, minutes: hour * 60 + minute };
}

/**
 * 把绝对时刻按指定时区偏移换算成墙上时钟。
 * @param {number} epochMs
 * @param {number} tzOffset - 相对 UTC 的分钟数，东八区为 +480
 */
export function wallClockFromEpoch(epochMs, tzOffset) {
  const shifted = new Date(epochMs + tzOffset * 60000);
  return makeTimeInfo({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  });
}

/**
 * 解析客户端时间。
 *
 * 优先接受「本地墙上时钟」字符串（如 2026-07-16T21:30:00 / 2026-07-16 21:30 / 21:30），
 * 直接按字面字段取值。若传入的是带 Z 或 ±hh:mm 的绝对时刻，则必须同时给出 tzOffset
 * 才能还原用户本地时间；给不出就返回 null —— 宁可不注入时间，也不注入错误的时间。
 *
 * @param {string|undefined} clientTime
 * @param {number|undefined} tzOffset - 相对 UTC 的分钟数，东八区为 +480
 * @returns {{ timeStr: string, dateStr: string, minutes: number }|null}
 */
function parseClientTime(clientTime, tzOffset) {
  if (!clientTime || typeof clientTime !== "string") return null;

  const trimmed = clientTime.trim();

  // 仅 HH:mm —— 本身就是墙上时钟
  const hm = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (hm) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour > 23 || minute > 59) return null;
    return makeTimeInfo({ hour, minute });
  }

  // 无时区后缀的本地时间 —— 按字面字段取值，不经过 Date 解析
  const local =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(trimmed);
  if (local) {
    const [, year, month, day, hour, minute] = local.map(Number);
    if (hour > 23 || minute > 59) return null;
    return makeTimeInfo({ year, month, day, hour, minute });
  }

  // 带时区的绝对时刻：只有拿到 tzOffset 才能还原成用户本地时间
  const absolute = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (absolute) {
    if (!Number.isFinite(tzOffset)) return null;
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    return wallClockFromEpoch(parsed, tzOffset);
  }

  return null;
}

/**
 * 将 HH:mm 转为当日分钟数
 * @param {string} time
 * @returns {number|null}
 */
function timeToMinutes(time) {
  if (!time || typeof time !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 找出当前时间前后 30 分钟内的提醒
 * @param {Array<{time:string, label:string}>|undefined} reminders
 * @param {{ minutes: number }} now
 * @returns {Array<{time:string, label:string}>}
 */
function findNearbyReminders(reminders, now) {
  if (!Array.isArray(reminders) || !now) return [];
  const windowMin = 30;

  return reminders.filter((r) => {
    const target = timeToMinutes(r.time);
    if (target == null) return false;
    const diff = Math.abs(now.minutes - target);
    return diff <= windowMin || diff >= 24 * 60 - windowMin;
  });
}

/**
 * 格式化 schedule 为 system 补充段（含时间感知）
 * @param {object|undefined} schedule
 * @param {string|undefined} clientTime
 * @param {number|undefined} tzOffset - 相对 UTC 的分钟数，东八区为 +480
 * @returns {string}
 */
export function buildScheduleSupplement(schedule, clientTime, tzOffset) {
  if (!schedule || typeof schedule !== "object") return "";

  const rhythmLabels = {
    gentle: "温和节奏 — 自然问候，不频繁打扰",
    active: "主动关怀 — 可更积极地关心用户状态",
    quiet: "安静陪伴 — 用户不主动时不强推话题",
  };

  const lines = ["## 陪伴日程与节奏"];

  if (schedule.rhythm) {
    lines.push(rhythmLabels[schedule.rhythm] || `节奏：${schedule.rhythm}`);
  }

  if (Array.isArray(schedule.dailyReminders) && schedule.dailyReminders.length) {
    lines.push("", "每日提醒时段：");
    schedule.dailyReminders.forEach((r) => {
      lines.push(`- ${r.time}：${r.label || "提醒"}`);
    });
  }

  if (Array.isArray(schedule.careTopics) && schedule.careTopics.length) {
    lines.push("", `主动关心话题：${schedule.careTopics.join("、")}`);
  }

  const now = parseClientTime(clientTime, tzOffset);
  if (now) {
    lines.push("", `当前用户本地时间：${now.dateStr}`);
    lines.push(
      "若当前时间接近上述某提醒时段（前后约 30 分钟内），可在回复中自然地主动提起对应话题，避免机械打卡式问候。"
    );

    const nearby = findNearbyReminders(schedule.dailyReminders, now);
    if (nearby.length) {
      lines.push(
        "",
        `⚠ 当前接近的提醒：${nearby.map((r) => `${r.time} ${r.label}`).join("；")}`
      );
    }
  }

  lines.push("", "请按上述节奏与话题自然地陪伴用户，不要复读配置原文。");
  return lines.join("\n");
}

/**
 * 拼接完整 runtime system prompt
 * @param {object} agent
 * @param {{ clientTime?: string, tzOffset?: number, allAgents?: object[], structured?: boolean }} options
 * @returns {string}
 */
export function buildRuntimeSystem(agent, options = {}) {
  const { clientTime, tzOffset, allAgents = [], structured = false } = options;
  const parts = [agent.system || ""];

  const skillsBlock = buildSkillsSupplement(agent.skills);
  if (skillsBlock) parts.push(skillsBlock);

  const handoffBlock = buildHandoffSupplement(agent.agentLinks, allAgents, structured);
  if (handoffBlock) parts.push(handoffBlock);

  const scheduleBlock = buildScheduleSupplement(agent.schedule, clientTime, tzOffset);
  if (scheduleBlock) parts.push(scheduleBlock);

  return parts.join("\n\n");
}

/**
 * 从 JSON 对象解析 structured handoff
 * @param {object|null} data
 * @param {Array<{targetId:string, label?:string}>|undefined} agentLinks
 * @returns {{ targetId: string, reason: string, label: string }|null}
 */
export function parseHandoffFromStructured(data, agentLinks) {
  const ho = data?.handoff;
  if (!ho || typeof ho !== "object" || !ho.targetId) return null;

  const targetId = String(ho.targetId).trim();
  const link = agentLinks?.find((l) => l.targetId === targetId);
  if (!link) return null;

  return {
    targetId,
    reason: typeof ho.reason === "string" ? ho.reason.trim() : link.trigger || "",
    label: link.label || targetId,
  };
}

/**
 * 从纯文本回复解析并剥离 handoff 标记
 * @param {string} reply
 * @param {Array<{targetId:string, label?:string}>|undefined} agentLinks
 * @returns {{ reply: string, handoff: object|null }}
 */
export function parseHandoffMarker(reply, agentLinks) {
  if (!reply || typeof reply !== "string") {
    return { reply: reply || "", handoff: null };
  }

  const match = reply.match(HANDOFF_MARKER_RE);
  if (!match) return { reply: reply.trim(), handoff: null };

  const targetId = match[1].trim();
  const reason = match[2].trim();
  const link = agentLinks?.find((l) => l.targetId === targetId);

  const cleaned = reply.replace(HANDOFF_MARKER_RE, "").trim();

  if (!link) return { reply: cleaned, handoff: null };

  return {
    reply: cleaned,
    handoff: {
      targetId,
      reason,
      label: link.label || targetId,
    },
  };
}

/** 标记开头（不要求出现在结尾：模型偶尔会在标记后继续写，那之后的正文一并扣住等收尾重排） */
const HANDOFF_MARKER_HEAD_RE = /^\[HANDOFF:[^:\]\s]+:[^\]]*\]/;

/** handoff 标记的字面前缀，用于判断半截标记 */
const HANDOFF_PREFIX = "[HANDOFF:";

/**
 * 流式输出时把缓冲区切成「可安全下发」与「需扣住」两段。
 *
 * 模型会在正文末尾输出 [HANDOFF:id:reason]，这个标记对用户不可见。流式下发时
 * 标记是逐字到达的，若照单全收，用户会亲眼看到 "[HAND..." 一个个蹦出来。
 *
 * 从左往右找第一个「可能开启标记」的中括号：正文里的普通中括号（如「见 [注1]」、
 * Markdown 链接）必须照常下发，不能卡住输出；只有标记本身及其之后的内容才扣住，
 * 留到流结束后按剥离过的正文统一补发。
 *
 * @param {string} buf - 尚未下发的缓冲
 * @returns {[string, string]} [可下发文本, 需继续扣住的尾巴]
 */
export function splitStreamSafe(buf) {
  for (let from = 0; ; ) {
    const idx = buf.indexOf("[", from);
    if (idx === -1) return [buf, ""];

    const tail = buf.slice(idx);

    // 已成形的标记：从这里起全部扣住
    if (HANDOFF_MARKER_HEAD_RE.test(tail)) return [buf.slice(0, idx), tail];

    // 尚未闭合，且还可能长成标记：扣住等后续字符
    if (
      !tail.includes("]") &&
      HANDOFF_PREFIX.startsWith(tail.slice(0, HANDOFF_PREFIX.length))
    ) {
      return [buf.slice(0, idx), tail];
    }

    from = idx + 1; // 这个中括号只是正文，继续往后找
  }
}

/**
 * 从原始 JSON 文本提取 handoff（structured 模式）
 * @param {string} raw
 * @param {Array<{targetId:string, label?:string}>|undefined} agentLinks
 * @returns {{ targetId: string, reason: string, label: string }|null}
 */
export function parseHandoffFromRawJson(raw, agentLinks) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const data = JSON.parse(raw.trim());
    return parseHandoffFromStructured(data, agentLinks);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const data = JSON.parse(raw.slice(start, end + 1));
        return parseHandoffFromStructured(data, agentLinks);
      } catch {
        return null;
      }
    }
  }
  return null;
}
