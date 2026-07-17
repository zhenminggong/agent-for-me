// 公开接口限流：POST /api/chat 无需口令，任何人拿到域名都能烧 DashScope 余额。
// 按 IP 做「分钟窗 + 日窗」双层计数，计数器存 KV。
//
// 设计取舍：
// - 没配 KV 时放行（与 _store.js 的降级哲学一致：演示环境不该因为没数据库就用不了）
// - KV 抖动/报错时放行（fail-open）：限流是防滥用的，不该让它成为对话的单点故障

const MINUTE_LIMIT_DEFAULT = 10;
const DAY_LIMIT_DEFAULT = 100;

/**
 * 读取正整数环境变量
 * @param {string} name
 * @param {number} fallback
 */
function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * 取客户端 IP。Vercel 边缘会写 x-forwarded-for，最左侧为真实客户端。
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || "unknown";
}

// 动态加载 KV（与 _store.js 保持同样的降级方式）
async function getKV() {
  try {
    if (!process.env.KV_REST_API_URL) return null;
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

/**
 * 对一个窗口计数并判断是否超限。
 * incr 返回自增后的值；首次命中（值为 1）时设置过期，让 key 自然回收。
 * @param {object} kv
 * @param {string} key
 * @param {number} limit
 * @param {number} ttlSec
 * @returns {Promise<{ count: number, exceeded: boolean }>}
 */
async function bumpWindow(kv, key, limit, ttlSec) {
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, ttlSec);
  return { count, exceeded: count > limit };
}

/**
 * 检查并累加某个 IP 的调用次数。
 * @param {string} ip
 * @param {object} [kvOverride] - 注入 KV（测试用）；省略时按环境自动获取
 * @returns {Promise<{ allowed: boolean, reason?: string, retryAfter?: number }>}
 */
export async function checkRateLimit(ip, kvOverride) {
  const kv = kvOverride || (await getKV());
  if (!kv) return { allowed: true }; // 未配 KV：放行

  const minuteLimit = envInt("RATE_LIMIT_PER_MIN", MINUTE_LIMIT_DEFAULT);
  const dayLimit = envInt("RATE_LIMIT_PER_DAY", DAY_LIMIT_DEFAULT);

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const dayBucket = Math.floor(now / 86400000);

  try {
    const minute = await bumpWindow(
      kv,
      `rl:min:${ip}:${minuteBucket}`,
      minuteLimit,
      70
    );
    if (minute.exceeded) {
      return {
        allowed: false,
        reason: `请求过于频繁（每分钟上限 ${minuteLimit} 次），请稍后再试。`,
        retryAfter: 60 - Math.floor((now % 60000) / 1000),
      };
    }

    const day = await bumpWindow(
      kv,
      `rl:day:${ip}:${dayBucket}`,
      dayLimit,
      86500
    );
    if (day.exceeded) {
      return {
        allowed: false,
        reason: `今日调用已达上限（${dayLimit} 次），请明天再来。`,
        retryAfter: Math.ceil((86400000 - (now % 86400000)) / 1000),
      };
    }

    return { allowed: true };
  } catch (err) {
    // KV 故障不应阻断对话
    console.error("[ratelimit] KV error, failing open:", err.message);
    return { allowed: true };
  }
}

/**
 * Express 风格中间件：超限时已写入 429 响应。
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<boolean>} 允许继续为 true
 */
export async function enforceRateLimit(req, res) {
  const ip = getClientIp(req);
  const result = await checkRateLimit(ip);
  if (result.allowed) return true;

  if (result.retryAfter) res.setHeader("Retry-After", String(result.retryAfter));
  res.status(429).json({ error: result.reason });
  return false;
}
