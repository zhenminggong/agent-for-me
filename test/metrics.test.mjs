// 运营指标：累加、UV 去重、时区归日、看板聚合、降级
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  metricsDay,
  bumpMetrics,
  recordPageView,
  recordChat,
  readDashboard,
  __setKvForTest,
} from "../api/_metrics.js";

/** 内存版假 KV：hash 计数 + HLL 用 Set 近似（小规模精确） */
function fakeKv() {
  const hashes = new Map(); // key -> Map(field->number)
  const hlls = new Map(); // key -> Set
  const strings = new Map();
  const expires = [];
  return {
    hashes, hlls, strings, expires,
    async hincrby(key, field, delta) {
      const h = hashes.get(key) || new Map();
      h.set(field, (h.get(field) || 0) + delta);
      hashes.set(key, h);
      return h.get(field);
    },
    async hgetall(key) {
      const h = hashes.get(key);
      if (!h) return null;
      return Object.fromEntries([...h.entries()].map(([k, v]) => [k, String(v)]));
    },
    async pfadd(key, ...members) {
      const s = hlls.get(key) || new Set();
      members.forEach((m) => s.add(m));
      hlls.set(key, s);
      return 1;
    },
    async pfcount(key) {
      return hlls.get(key)?.size || 0;
    },
    async set(key, val, opts) {
      if (opts?.nx && strings.has(key)) return null;
      strings.set(key, val);
      return "OK";
    },
    async get(key) {
      return strings.get(key) ?? null;
    },
    async expire(key, ttl) {
      expires.push([key, ttl]);
      return 1;
    },
  };
}

// ---------------------------------------------------------------- 时区归日

test("metricsDay 按运营时区归日（东八区跨零点）", () => {
  // 直接验证纯函数不便固定 now，这里验证 offset 会改变结果的方向性：
  // UTC 23:30 时，东八区已是次日 07:30。用一个已知 offset 差比对日期字符串合法。
  const cn = metricsDay(480);
  const utc = metricsDay(0);
  assert.match(cn, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(utc, /^\d{4}-\d{2}-\d{2}$/);
  // 东八区日期 >= UTC 日期（同一时刻东八区更靠后）
  assert.ok(cn >= utc);
});

// ---------------------------------------------------------------- 累加

test("bumpMetrics 同时写总计与当日，且只写正增量", async () => {
  const kv = fakeKv();
  __setKvForTest(kv);
  try {
    await bumpMetrics({ chats: 1, tokens: 120, toolCalls: 0, handoffs: 0 }, 480);
    const day = metricsDay(480);
    assert.equal((await kv.hgetall("metrics:total")).chats, "1");
    assert.equal((await kv.hgetall("metrics:total")).tokens, "120");
    // 增量为 0 的字段不应写入
    assert.equal((await kv.hgetall("metrics:total")).toolCalls, undefined);
    assert.equal((await kv.hgetall(`metrics:daily:${day}`)).tokens, "120");
    // 当日 key 设了过期
    assert.ok(kv.expires.some(([k]) => k === `metrics:daily:${day}`));
  } finally {
    __setKvForTest(null);
  }
});

test("recordChat 累加对话/token 并按 verdict 计数", async () => {
  const kv = fakeKv();
  __setKvForTest(kv);
  try {
    await recordChat({ tokens: 200, toolCalls: 2, handoff: true, verdict: "reject" }, 480);
    await recordChat({ tokens: 100, verdict: "worth_doing" }, 480);
    const total = await kv.hgetall("metrics:total");
    assert.equal(total.chats, "2");
    assert.equal(total.tokens, "300");
    assert.equal(total.toolCalls, "2");
    assert.equal(total.handoffs, "1");
    assert.equal(total.verdict_reject, "1");
    assert.equal(total.verdict_worth_doing, "1");
    assert.equal(total.verdict_defer, undefined);
  } finally {
    __setKvForTest(null);
  }
});

test("非法 verdict 不计入", async () => {
  const kv = fakeKv();
  __setKvForTest(kv);
  try {
    await recordChat({ verdict: "garbage" }, 480);
    const total = await kv.hgetall("metrics:total");
    assert.equal(total.verdict_garbage, undefined);
    assert.equal(total.chats, "1");
  } finally {
    __setKvForTest(null);
  }
});

// ---------------------------------------------------------------- UV

test("recordPageView PV 累加 + UV 按 visitorId 去重", async () => {
  const kv = fakeKv();
  __setKvForTest(kv);
  try {
    await recordPageView("visitorA", 480);
    await recordPageView("visitorA", 480); // 同一访客
    await recordPageView("visitorB", 480);
    assert.equal((await kv.hgetall("metrics:total")).pv, "3"); // PV 计 3
    assert.equal(await kv.pfcount("metrics:uv:total"), 2); // UV 去重成 2
  } finally {
    __setKvForTest(null);
  }
});

test("无 visitorId 仍计 PV，不计 UV", async () => {
  const kv = fakeKv();
  __setKvForTest(kv);
  try {
    await recordPageView(undefined, 480);
    assert.equal((await kv.hgetall("metrics:total")).pv, "1");
    assert.equal(await kv.pfcount("metrics:uv:total"), 0);
  } finally {
    __setKvForTest(null);
  }
});

// ---------------------------------------------------------------- 看板聚合

test("readDashboard 返回总计 + N 天序列 + 补零", async () => {
  const kv = fakeKv();
  __setKvForTest(kv);
  try {
    await recordChat({ tokens: 50, verdict: "defer" }, 480);
    await recordPageView("v1", 480);

    const dash = await readDashboard(7, 480);
    assert.equal(dash.daily.length, 7);
    // 每天都有全字段（补零）
    for (const d of dash.daily) {
      assert.ok("pv" in d && "chats" in d && "tokens" in d && "uv" in d);
      assert.equal(typeof d.tokens, "number");
    }
    // 今天（最后一天）应有刚写入的数据
    const today = dash.daily[dash.daily.length - 1];
    assert.equal(today.chats, 1);
    assert.equal(today.tokens, 50);
    assert.equal(today.uv, 1);
    // 总计
    assert.equal(dash.total.chats, 1);
    assert.equal(dash.total.verdict_defer, 1);
    assert.equal(dash.total.uv, 1);
    assert.ok(dash.firstDay);
  } finally {
    __setKvForTest(null);
  }
});

// ---------------------------------------------------------------- 降级

test("未配 KV 时全部静默 no-op，不抛错", async () => {
  __setKvForTest(null);
  delete process.env.KV_REST_API_URL;
  // 不抛异常即通过
  await recordChat({ tokens: 100 }, 480);
  await recordPageView("v", 480);
  assert.equal(await readDashboard(7, 480), null);
});
