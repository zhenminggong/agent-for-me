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

  const lines = skills.map((s) => {
    const icon = s.icon || "✦";
    const name = s.name || s.id || "未命名技能";
    const desc = s.desc ? `: ${s.desc}` : "";
    return `- ${icon} ${name}${desc}`;
  });

  return [
    "## 你可用的技能",
    ...lines,
    "",
    "请在回复中主动运用上述技能；必要时简要说明正在使用哪项技能。",
  ].join("\n");
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

/**
 * 解析客户端时间
 * @param {string|undefined} clientTime - ISO 字符串或 HH:mm
 * @returns {{ date: Date, timeStr: string, dateStr: string, minutes: number }|null}
 */
function parseClientTime(clientTime) {
  if (!clientTime || typeof clientTime !== "string") return null;

  const trimmed = clientTime.trim();

  // 仅 HH:mm
  const hmMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (hmMatch) {
    const now = new Date();
    now.setHours(Number(hmMatch[1]), Number(hmMatch[2]), 0, 0);
    return formatTimeInfo(now);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatTimeInfo(parsed);
}

/**
 * @param {Date} date
 */
function formatTimeInfo(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${timeStr}`;
  return {
    date,
    timeStr,
    dateStr,
    minutes: date.getHours() * 60 + date.getMinutes(),
  };
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
 * @returns {string}
 */
export function buildScheduleSupplement(schedule, clientTime) {
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

  const now = parseClientTime(clientTime);
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
 * @param {{ clientTime?: string, allAgents?: object[], structured?: boolean }} options
 * @returns {string}
 */
export function buildRuntimeSystem(agent, options = {}) {
  const { clientTime, allAgents = [], structured = false } = options;
  const parts = [agent.system || ""];

  const skillsBlock = buildSkillsSupplement(agent.skills);
  if (skillsBlock) parts.push(skillsBlock);

  const handoffBlock = buildHandoffSupplement(agent.agentLinks, allAgents, structured);
  if (handoffBlock) parts.push(handoffBlock);

  const scheduleBlock = buildScheduleSupplement(agent.schedule, clientTime);
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
