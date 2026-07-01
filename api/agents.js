// /api/agents —— Agent 配置的增删改查
// GET    列出所有 Agent
// POST   新增/更新一个 Agent
// DELETE 删除一个 Agent(?id=xxx)

import { listAgents, saveAgent, deleteAgent } from "./_store.js";
import { toPublic } from "./_seed.js";
import { requireAdmin } from "./_auth.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const full = req.query.full === "1";
      if (full && !requireAdmin(req, res)) return;
      const { agents, editable } = await listAgents();
      // 列表给前端聊天界面用,去掉 system;管理后台需要 system,用 ?full=1
      return res.status(200).json({
        agents: full ? agents : agents.map(toPublic),
        editable,
      });
    }

    if (req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const agent = req.body;
      // 基础校验
      if (!agent?.id || !agent?.name || !agent?.system) {
        return res
          .status(400)
          .json({ error: "缺少必填字段:id、name、system" });
      }
      // id 只允许字母数字和连字符
      if (!/^[a-zA-Z0-9_-]+$/.test(agent.id)) {
        return res
          .status(400)
          .json({ error: "id 只能用字母、数字、下划线、连字符" });
      }
      const saved = await saveAgent({
        id: agent.id,
        name: agent.name,
        tagline: agent.tagline || "",
        desc: agent.desc || "",
        placeholder: agent.placeholder || "说点什么……",
        accent: agent.accent || "#E8915B",
        icon: agent.icon || "✦",
        temperature: typeof agent.temperature === "number" ? agent.temperature : 0.6,
        responseMode: agent.responseMode || undefined,
        greeting: agent.greeting || "你好，有什么可以帮你的？",
        samples: Array.isArray(agent.samples) ? agent.samples : [],
        skills: Array.isArray(agent.skills) ? agent.skills : [],
        agentLinks: Array.isArray(agent.agentLinks) ? agent.agentLinks : [],
        schedule: agent.schedule && typeof agent.schedule === "object" ? agent.schedule : undefined,
        system: agent.system,
      });
      return res.status(200).json({ agent: saved });
    }

    if (req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "缺少 id" });
      await deleteAgent(id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
