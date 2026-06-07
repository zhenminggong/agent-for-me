// /api/chat —— 对话
// 关键:system prompt 从存储实时读取,所以在后台改完 prompt 立即生效,无需重新部署。
// API key 存在环境变量,前端永远拿不到。

import { getAgent } from "./_store.js";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

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

    const payload = {
      model: "qwen-plus",
      messages: [{ role: "system", content: agent.system }, ...messages],
      temperature: typeof agent.temperature === "number" ? agent.temperature : 0.6,
    };

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
      return res
        .status(resp.status)
        .json({ error: `模型接口报错: ${errText.slice(0, 200)}` });
    }

    const data = await resp.json();
    const reply =
      data.choices?.[0]?.message?.content || "(模型没有返回内容,请重试)";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: `服务端异常: ${err.message}` });
  }
}
