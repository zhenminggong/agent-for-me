// /api/metrics —— 运营指标
//   POST            公开：上报一次页面浏览 { visitorId, tzOffset }
//   GET  ?days=14   公开只读：返回看板数据（总计 + 每日序列 + UV）
//
// 看板是作品的展示门面，读取刻意做成公开——访客/面试官不登录就能看到运营数据。
// 这些是聚合统计（PV、token、裁决分布），不含任何用户内容或隐私。
// 写操作（改 Agent）仍走 /api/agents 的管理鉴权，不受影响。

import { recordPageView, readDashboard } from "./_metrics.js";
import { enforceRateLimit } from "./_ratelimit.js";

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      // 复用对话接口那套 IP 限流，防止有人刷 PV
      if (!(await enforceRateLimit(req, res))) return;

      const { visitorId, tzOffset } = req.body || {};
      const offset = typeof tzOffset === "number" ? tzOffset : 480;
      // 埋点失败不该影响前端，静默吞掉
      await recordPageView(
        typeof visitorId === "string" ? visitorId.slice(0, 64) : undefined,
        offset
      ).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (req.method === "GET") {
      const days = Number(req.query.days) || 14;
      const tzOffset = Number(req.query.tzOffset);
      const data = await readDashboard(days, Number.isFinite(tzOffset) ? tzOffset : 480);

      if (!data) {
        return res.status(200).json({ available: false, reason: "未配置 KV，无运营数据" });
      }
      return res.status(200).json({ available: true, ...data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
