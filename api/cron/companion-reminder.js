/**
 * 陪伴 Agent 日程 cron（MVP）
 * Vercel Cron 每小时触发，预热 schedule 配置并记录当前应关注的提醒时段。
 * 主要陪伴逻辑仍由对话时的 prompt 注入 + clientTime 时间感知驱动。
 */

import { listAgents } from "../_store.js";

/**
 * HH:mm → 当日分钟数
 * @param {string} time
 */
function timeToMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 找出当前小时窗口内（±30 分钟）的提醒
 * @param {Array<{time:string, label:string}>} reminders
 * @param {Date} now
 */
function activeReminders(reminders, now) {
  if (!Array.isArray(reminders)) return [];
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const windowMin = 30;

  return reminders.filter((r) => {
    const target = timeToMinutes(r.time);
    if (target == null) return false;
    const diff = Math.abs(currentMin - target);
    return diff <= windowMin;
  });
}

export default async function handler(req, res) {
  // Vercel Cron 会带 Authorization header；本地调试允许跳过
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const { agents } = await listAgents();
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const companions = agents.filter(
      (a) => a.schedule && (a.schedule.dailyReminders?.length || a.schedule.careTopics?.length)
    );

    const snapshot = companions.map((agent) => {
      const active = activeReminders(agent.schedule?.dailyReminders, now);
      return {
        agentId: agent.id,
        agentName: agent.name,
        rhythm: agent.schedule?.rhythm,
        activeReminders: active,
        careTopics: agent.schedule?.careTopics || [],
      };
    });

    // MVP：仅 log + 返回快照，后续可写入 KV 供 push 通知
    console.log("[companion-reminder]", timeStr, JSON.stringify(snapshot));

    return res.status(200).json({
      ok: true,
      serverTime: now.toISOString(),
      localTime: timeStr,
      companions: snapshot,
    });
  } catch (err) {
    console.error("[companion-reminder] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
