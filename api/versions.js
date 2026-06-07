// /api/versions —— Agent 的历史版本
// GET ?id=xxx  列出某 Agent 的历史版本(用于回滚)

import { listVersions } from "./_store.js";
import { requireAdmin } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireAdmin(req, res)) return;
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "缺少 id" });
  try {
    const versions = await listVersions(id);
    return res.status(200).json({ versions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
