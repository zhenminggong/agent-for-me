// 限流：窗口计数、IP 隔离、降级与故障放行
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, getClientIp } from "../api/_ratelimit.js";

/** 内存版假 KV，并记录 expire 调用 */
function fakeKv() {
  const store = new Map();
  const expires = [];
  return {
    store, expires,
    async incr(k) { const v = (store.get(k) || 0) + 1; store.set(k, v); return v; },
    async expire(k, ttl) { expires.push([k, ttl]); return 1; },
  };
}

process.env.RATE_LIMIT_PER_MIN = "3";
process.env.RATE_LIMIT_PER_DAY = "5";

test("分钟窗超限即拦，并给出 Retry-After", async () => {
  const kv = fakeKv();
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await checkRateLimit("1.1.1.1", kv));

  assert.ok(results.slice(0, 3).every((r) => r.allowed), "前 3 次应放行");
  assert.equal(results[3].allowed, false);
  assert.match(results[3].reason, /每分钟上限 3 次/);
  assert.ok(results[3].retryAfter > 0 && results[3].retryAfter <= 60);
});

test("TTL 只在首次命中时设置，避免每次续期导致窗口永不过期", async () => {
  const kv = fakeKv();
  for (let i = 0; i < 3; i++) await checkRateLimit("1.1.1.2", kv);
  const minuteExpires = kv.expires.filter(([k]) => k.startsWith("rl:min:"));
  assert.equal(minuteExpires.length, 1);
  assert.equal(minuteExpires[0][1], 70);
});

test("不同 IP 计数互不影响", async () => {
  const kv = fakeKv();
  for (let i = 0; i < 3; i++) await checkRateLimit("2.2.2.2", kv);
  assert.equal((await checkRateLimit("3.3.3.3", kv)).allowed, true);
});

test("日窗在跨分钟后仍然生效", async () => {
  const kv = fakeKv();
  let last;
  for (let i = 0; i < 6; i++) {
    // 清掉分钟计数模拟跨分钟，只留日窗约束
    for (const k of [...kv.store.keys()]) if (k.startsWith("rl:min:")) kv.store.delete(k);
    last = await checkRateLimit("4.4.4.4", kv);
  }
  assert.equal(last.allowed, false);
  assert.match(last.reason, /今日调用已达上限（5 次）/);
  assert.equal(kv.expires.find(([k]) => k.startsWith("rl:day:"))[1], 86500);
});

// 限流是防滥用的，不该成为对话的单点故障。
test("未配 KV → 放行（降级）", async () => {
  delete process.env.KV_REST_API_URL;
  assert.equal((await checkRateLimit("5.5.5.5")).allowed, true);
});

test("KV 故障 → fail-open 放行（故障注入）", async () => {
  const broken = { async incr() { throw new Error("KV down"); }, async expire() {} };
  assert.equal((await checkRateLimit("6.6.6.6", broken)).allowed, true);
});

test("getClientIp 取 XFF 最左侧真实客户端", () => {
  assert.equal(getClientIp({ headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" } }), "203.0.113.9");
  assert.equal(getClientIp({ headers: { "x-real-ip": "198.51.100.7" } }), "198.51.100.7");
  assert.equal(getClientIp({ headers: {}, socket: { remoteAddress: "10.0.0.1" } }), "10.0.0.1");
  assert.equal(getClientIp({ headers: {} }), "unknown");
});
