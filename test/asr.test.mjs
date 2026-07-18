// /api/asr 处理层：输入校验 + 成功路径（mock DashScope，不需真 key）
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DASHSCOPE_API_KEY = "test-key";
delete process.env.KV_REST_API_URL; // 限流无 KV → fail-open 放行

const { default: asr } = await import("../api/asr.js");

function mock(method, body, headers = {}) {
  const res = {
    statusCode: 200, _json: null,
    status(c) { this.statusCode = c; return this; },
    setHeader() {}, json(o) { this._json = o; return this; }, end() {},
  };
  return { req: { method, body, headers, socket: { remoteAddress: "1.2.3.4" } }, res };
}

const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZF"; // 头部即可，校验只看前缀

let realFetch;
test.before(() => { realFetch = globalThis.fetch; });
test.after(() => { globalThis.fetch = realFetch; });

test("非 POST → 405", async () => {
  const { req, res } = mock("GET", {});
  await asr(req, res);
  assert.equal(res.statusCode, 405);
});

test("audio 缺失/格式不对 → 400", async () => {
  for (const bad of [undefined, "hello", "data:image/png;base64,xxx", 123]) {
    const { req, res } = mock("POST", { audio: bad });
    await asr(req, res);
    assert.equal(res.statusCode, 400, `bad=${JSON.stringify(bad)}`);
  }
});

test("音频过大 → 413", async () => {
  const huge = "data:audio/wav;base64," + "A".repeat(15 * 1024 * 1024);
  const { req, res } = mock("POST", { audio: huge });
  await asr(req, res);
  assert.equal(res.statusCode, 413);
});

test("合法音频 → 调 qwen3-asr-flash 并返回文字", async () => {
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    assert.ok(String(url).includes("/compatible-mode/v1/chat/completions"));
    assert.equal(opts.headers.Authorization, "Bearer test-key");
    return { ok: true, async json() { return { choices: [{ message: { content: "你好世界" } }], usage: { seconds: 2 } }; } };
  };
  const { req, res } = mock("POST", { audio: WAV });
  await asr(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res._json.text, "你好世界");
  assert.equal(res._json.seconds, 2);
  // 请求组装正确
  assert.equal(sentBody.model, "qwen3-asr-flash");
  assert.equal(sentBody.messages[0].content[0].type, "input_audio");
  assert.equal(sentBody.messages[0].content[0].input_audio.data, WAV);
  assert.equal(sentBody.extra_body.asr_options.language, "zh");
  assert.equal(sentBody.extra_body.asr_options.enable_itn, true);
});

test("language 可覆盖（如 en）", async () => {
  let sentBody = null;
  globalThis.fetch = async (_u, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, async json() { return { choices: [{ message: { content: "hi" } }] }; } };
  };
  const { req, res } = mock("POST", { audio: WAV, language: "en" });
  await asr(req, res);
  assert.equal(sentBody.extra_body.asr_options.language, "en");
});

test("上游报错 → 502，且不泄整段错误", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, async text() { return "InvalidApiKey: xxxxxxxx"; } });
  const { req, res } = mock("POST", { audio: WAV });
  await asr(req, res);
  assert.equal(res.statusCode, 502);
  assert.match(res._json.error, /识别接口报错/);
});

test("mp3 mediatype 归一化为 mpeg", async () => {
  let sentBody = null;
  globalThis.fetch = async (_u, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, async json() { return { choices: [{ message: { content: "x" } }] }; } };
  };
  const { req, res } = mock("POST", { audio: "data:audio/mp3;base64,SUQzBA" });
  await asr(req, res);
  assert.match(sentBody.messages[0].content[0].input_audio.data, /^data:audio\/mpeg;base64,/);
});
