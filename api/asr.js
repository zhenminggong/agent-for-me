// /api/asr —— 语音识别（语音输入）
// 前端把录音转成 WAV、base64 成 data URI 传来，这里调百炼 qwen3-asr-flash 同步识别，返回文字。
// 复用 DASHSCOPE_API_KEY，与 /api/chat 同一个 endpoint 与鉴权。

import { enforceRateLimit } from "./_ratelimit.js";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// qwen3-asr-flash 单条上限约 10MB；base64 后体积约 +33%，这里按 base64 长度粗略卡 14MB
const MAX_DATA_URI_LEN = 14 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "服务端未配置 DASHSCOPE_API_KEY" });
  }

  // 复用对话那套 IP 限流，防止有人刷语音识别烧额度
  if (!(await enforceRateLimit(req, res))) return;

  try {
    const { audio, language } = req.body || {};

    if (typeof audio !== "string" || !/^data:audio\/(wav|mpeg|mp3);base64,/.test(audio)) {
      return res.status(400).json({
        error: "audio 需为 data:audio/wav;base64,... 或 data:audio/mpeg;base64,... 格式",
      });
    }
    if (audio.length > MAX_DATA_URI_LEN) {
      return res.status(413).json({ error: "音频过大，请录短一点（≤ 约 10MB）" });
    }

    // mp3 的 mediatype 规范写法是 audio/mpeg，统一一下
    const normalized = audio.replace(/^data:audio\/mp3;base64,/, "data:audio/mpeg;base64,");

    const payload = {
      model: "qwen3-asr-flash",
      messages: [
        { role: "user", content: [{ type: "input_audio", input_audio: { data: normalized } }] },
      ],
      stream: false,
      extra_body: {
        asr_options: {
          enable_itn: true, // 口语数字/标点规整，如"一百二" → "120"
          language: typeof language === "string" && language ? language : "zh",
        },
      },
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
      return res.status(502).json({ error: `识别接口报错: ${errText.slice(0, 200)}` });
    }

    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    const seconds = data.usage?.seconds;

    return res.status(200).json({ text, seconds });
  } catch (err) {
    return res.status(500).json({ error: `服务端异常: ${err.message}` });
  }
}
