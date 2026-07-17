// /api/metrics —— 运营指标
//   POST            公开：上报一次页面浏览 { visitorId, tzOffset }
//   GET  ?days=14   需管理鉴权：返回看板数据（总计 + 每日序列 + UV）
//
// 浏览上报走公开 POST：它只会 +1，不泄露任何数据；读取才需要口令。

import { recordPageView, readDashboard } from "./_metrics.js";
import { requireAdmin } from "./_auth.js";
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
      if (!requireAdmin(req, res)) return;

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
