// 运营指标收集层。
//
// 与 _store.js / _ratelimit.js 相同的降级哲学：没配 KV 就静默 no-op，
// 任何写入失败都不得阻断主流程（埋点挂了不该让用户聊不了天）。
//
// KV schema：
//   metrics:total                （hash）累计计数：pv / chats / tokens / toolCalls / handoffs / verdict_*
//   metrics:daily:<YYYY-MM-DD>    （hash）当日计数，同字段；约 13 个月后自然过期
//   metrics:uv:total             （HyperLogLog）累计独立访客
//   metrics:uv:<YYYY-MM-DD>      （HyperLogLog）当日独立访客
//   metrics:firstDay             （string）第一条数据的日期，用于前端算"运营天数"
//
// 用 hincrby 原子累加、HLL 估算去重 UV——都是 O(1)、并发安全，不用读改写。

const TOTAL_KEY = "metrics:total";
const DAILY_PREFIX = "metrics:daily:";
const UV_TOTAL_KEY = "metrics:uv:total";
const UV_DAILY_PREFIX = "metrics:uv:";
const FIRST_DAY_KEY = "metrics:firstDay";

const DAILY_TTL_SEC = 400 * 86400; // 每日明细留约 13 个月

/** 所有会累加的计数字段，读取时按此补零 */
export const METRIC_FIELDS = [
  "pv",
  "chats",
  "tokens",
  "toolCalls",
  "handoffs",
  "verdict_worth_doing",
  "verdict_defer",
  "verdict_reject",
];

let _kvOverride = null;
/** 测试注入用：传入内存版 KV，传 null 复位 */
export function __setKvForTest(kv) {
  _kvOverride = kv;
}

async function getKV() {
  if (_kvOverride) return _kvOverride;
  try {
    if (!process.env.KV_REST_API_URL) return null;
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

/**
 * 按运营时区取当天日期 YYYY-MM-DD。
 * 服务端跑在 UTC，直接用会把跨零点的当地流量算到前一天，故按 offset 平移。
 * @param {number} tzOffset - 相对 UTC 的分钟数，默认东八区 +480
 */
export function metricsDay(tzOffset = 480) {
  return new Date(Date.now() + tzOffset * 60000).toISOString().slice(0, 10);
}

/**
 * 累加一组计数到「总计」与「当日」两个 hash。
 * @param {Record<string, number>} increments - 字段 → 增量（>0 才写）
 * @param {number} [tzOffset]
 */
export async function bumpMetrics(increments, tzOffset = 480) {
  const kv = await getKV();
  if (!kv) return;

  const entries = Object.entries(increments).filter(([, v]) => Number(v) > 0);
  if (!entries.length) return;

  const dailyKey = DAILY_PREFIX + metricsDay(tzOffset);

  try {
    const ops = [];
    for (const [field, delta] of entries) {
      ops.push(kv.hincrby(TOTAL_KEY, field, delta));
      ops.push(kv.hincrby(dailyKey, field, delta));
    }
    await Promise.all(ops);
    await kv.expire(dailyKey, DAILY_TTL_SEC);
    await kv.set(FIRST_DAY_KEY, metricsDay(tzOffset), { nx: true });
  } catch (err) {
    console.error("[metrics] bump failed (ignored):", err.message);
  }
}

/**
 * 记录一次页面浏览：PV 计数 + 按 visitorId 去重的 UV。
 * @param {string} visitorId - 前端 localStorage 里的匿名访客 id
 * @param {number} [tzOffset]
 */
export async function recordPageView(visitorId, tzOffset = 480) {
  const kv = await getKV();
  if (!kv) return;

  const day = metricsDay(tzOffset);
  try {
    await bumpMetrics({ pv: 1 }, tzOffset);
    if (visitorId && typeof visitorId === "string") {
      const uvDailyKey = UV_DAILY_PREFIX + day;
      await kv.pfadd(uvDailyKey, visitorId);
      await kv.expire(uvDailyKey, DAILY_TTL_SEC);
      await kv.pfadd(UV_TOTAL_KEY, visitorId);
    }
  } catch (err) {
    console.error("[metrics] pageview failed (ignored):", err.message);
  }
}

/**
 * 一次对话完成后记录：对话数、token、工具调用、handoff、裁决结果。
 * @param {{tokens?:number, toolCalls?:number, handoff?:boolean, verdict?:string}} m
 * @param {number} [tzOffset]
 */
export async function recordChat(
  { tokens = 0, toolCalls = 0, handoff = false, verdict } = {},
  tzOffset = 480
) {
  const inc = { chats: 1, tokens, toolCalls };
  if (handoff) inc.handoffs = 1;
  if (verdict && ["worth_doing", "defer", "reject"].includes(verdict)) {
    inc[`verdict_${verdict}`] = 1;
  }
  await bumpMetrics(inc, tzOffset);
}

/** 把 KV hash（值为字符串）转成按 METRIC_FIELDS 补零的数字对象 */
function normalizeCounts(hash) {
  const out = {};
  for (const f of METRIC_FIELDS) out[f] = Number(hash?.[f]) || 0;
  return out;
}

/**
 * 读取看板数据：总计 + 最近 N 天每日序列 + UV。
 * @param {number} days
 * @param {number} [tzOffset]
 * @returns {Promise<object|null>} 未配 KV 返回 null
 */
export async function readDashboard(days = 14, tzOffset = 480) {
  const kv = await getKV();
  if (!kv) return null;

  const span = Math.min(Math.max(Number(days) || 14, 1), 90);

  const dayList = [];
  for (let i = span - 1; i >= 0; i--) {
    dayList.push(new Date(Date.now() + tzOffset * 60000 - i * 86400000).toISOString().slice(0, 10));
  }

  const [total, uvTotal, firstDay, ...dailyHashes] = await Promise.all([
    kv.hgetall(TOTAL_KEY),
    kv.pfcount(UV_TOTAL_KEY),
    kv.get(FIRST_DAY_KEY),
    ...dayList.map((d) => kv.hgetall(DAILY_PREFIX + d)),
  ]);

  const uvCounts = await Promise.all(dayList.map((d) => kv.pfcount(UV_DAILY_PREFIX + d)));

  const daily = dayList.map((date, i) => ({
    date,
    ...normalizeCounts(dailyHashes[i]),
    uv: Number(uvCounts[i]) || 0,
  }));

  return {
    total: { ...normalizeCounts(total), uv: Number(uvTotal) || 0 },
    daily,
    firstDay: firstDay || dayList[dayList.length - 1],
    generatedAt: new Date().toISOString(),
  };
}
