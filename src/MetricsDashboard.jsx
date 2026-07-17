import { useState, useEffect, useCallback } from "react";

/**
 * 一组标注为「演示数据」的形态预览。
 * 用于：没配 KV、还没有真实对话/裁决、或读取失败时——让访客/面试官一进来就看懂
 * 这个看板能统计什么，而不是一片空白或尴尬的一堆 0。始终配合顶部「演示数据」横幅，
 * 明说是形态展示、绝不冒充真实运营。裁决分布刻意让「不建议用 AI」占最高，呼应裁决官定位。
 */
function buildDemoData(span) {
  const now = Date.now();
  const daily = [];
  for (let i = span - 1; i >= 0; i--) {
    const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
    const t = span - i; // 1..span
    const wave = 1 + 0.3 * Math.sin(t * 0.8);
    const growth = 0.6 + 0.5 * (t / span);
    const pv = Math.max(6, Math.round(34 * wave * growth));
    daily.push({
      date,
      pv,
      uv: Math.round(pv * 0.44),
      chats: Math.round(pv * 0.32 * (0.9 + 0.2 * Math.sin(t))),
      tokens: Math.round(pv * 0.32 * 330),
      toolCalls: Math.round(pv * 0.08),
      handoffs: Math.round(pv * 0.03),
      // 裁决偏向劝退，让"劝退率"趋势有内容且居高
      verdict_worth_doing: Math.round(pv * 0.015),
      verdict_defer: Math.max(1, Math.round(pv * 0.025)),
      verdict_reject: Math.max(1, Math.round(pv * 0.05)),
    });
  }
  // 行业分类演示：高风险行业（法律/医疗/金融）劝退率高，呼应裁决官定位
  const cats = [
    { category: "retail", worth: 5, defer: 6, reject: 4 },
    { category: "legal", worth: 1, defer: 2, reject: 9 },
    { category: "medical", worth: 0, defer: 1, reject: 7 },
    { category: "content", worth: 5, defer: 3, reject: 3 },
    { category: "finance", worth: 1, defer: 2, reject: 6 },
    { category: "education", worth: 2, defer: 2, reject: 2 },
    { category: "service", worth: 3, defer: 3, reject: 2 },
  ].map((c) => {
    const total = c.worth + c.defer + c.reject;
    return { ...c, total, rejectRate: total ? c.reject / total : 0 };
  }).sort((a, b) => b.total - a.total);

  return {
    total: {
      pv: 1240, uv: 418, chats: 356, tokens: 132400,
      toolCalls: 92, handoffs: 27,
      verdict_worth_doing: 17, verdict_defer: 19, verdict_reject: 33,
    },
    daily,
    categories: cats,
    firstDay: daily[0].date,
  };
}

/** 千分位；大数用 k/M 简写 */
function fmt(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString("en-US");
}

/** 月-日 */
function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 顶部数字卡片 */
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="metric-card" style={accent ? { "--metric-accent": accent } : undefined}>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

/**
 * 每日趋势迷你柱图（纯内联 SVG，无第三方库）。
 * 每天一根柱，高度按该系列最大值归一；hover 显示 tooltip。
 */
function TrendBars({ daily, field, label }) {
  const max = Math.max(1, ...daily.map((d) => d[field] || 0));
  const W = 100;
  const H = 44;
  const gap = 2;
  const bw = (W - gap * (daily.length - 1)) / daily.length;

  return (
    <div className="trend">
      <div className="trend-head">
        <span className="trend-label">{label}</span>
        <span className="trend-max">峰值 {fmt(max)}</span>
      </div>
      <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {daily.map((d, i) => {
          const v = d[field] || 0;
          const h = v > 0 ? Math.max(1.5, (v / max) * H) : 0;
          return (
            <rect
              key={d.date}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={0.6}
              className="trend-bar"
            >
              <title>{`${d.date}：${fmt(v)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="trend-axis">
        <span>{shortDate(daily[0].date)}</span>
        <span>{shortDate(daily[daily.length - 1].date)}</span>
      </div>
    </div>
  );
}

/** 裁决结果分布：三段占比条 */
function VerdictBar({ total }) {
  const worth = total.verdict_worth_doing || 0;
  const defer = total.verdict_defer || 0;
  const reject = total.verdict_reject || 0;
  const sum = worth + defer + reject;

  if (sum === 0) {
    return <div className="verdict-empty">还没有裁决官的评估记录。</div>;
  }

  const seg = [
    { key: "worth", label: "能做且值得", v: worth, color: "#3f9d6b" },
    { key: "defer", label: "能做但不值", v: defer, color: "#d99a3c" },
    { key: "reject", label: "不建议用 AI", v: reject, color: "#c45c4a" },
  ];

  return (
    <div className="verdict">
      <div className="verdict-bar">
        {seg.map((s) =>
          s.v > 0 ? (
            <div
              key={s.key}
              className="verdict-seg"
              style={{ width: `${(s.v / sum) * 100}%`, background: s.color }}
              title={`${s.label}：${s.v}（${((s.v / sum) * 100).toFixed(0)}%）`}
            />
          ) : null
        )}
      </div>
      <div className="verdict-legend">
        {seg.map((s) => (
          <span key={s.key} className="verdict-legend-item">
            <i style={{ background: s.color }} />
            {s.label} <b>{s.v}</b>
            <span className="verdict-pct">{sum ? `${((s.v / sum) * 100).toFixed(0)}%` : "0%"}</span>
          </span>
        ))}
      </div>
      <p className="verdict-note">
        「不建议用 AI」占比越高，越说明裁决官在认真劝退——这正是它的价值所在。
      </p>
    </div>
  );
}

/** 行业 id → 中文标签（与后端 _feasibility.js 的 CATEGORY_LABELS 对应） */
const CATEGORY_LABELS = {
  retail: "零售/电商", food: "餐饮", education: "教育", legal: "法律",
  medical: "医疗健康", finance: "金融", manufacturing: "制造/工业",
  content: "内容/营销", service: "客服/服务", hr: "人力/行政",
  logistics: "物流/供应链", other: "其他",
};
const catLabel = (id) => CATEGORY_LABELS[id] || id;

/**
 * 裁决官洞察：劝退率大数 + 劝退率趋势 + 最常被劝退的行业。
 * 呼应项目灵魂——用数据证明"它真的在拦坏主意"。
 */
function JudgeInsights({ total, daily, categories }) {
  const worth = total.verdict_worth_doing || 0;
  const defer = total.verdict_defer || 0;
  const reject = total.verdict_reject || 0;
  const judged = worth + defer + reject;

  if (judged === 0) {
    return <div className="verdict-empty">还没有裁决官的评估记录，用它评估几个业务场景后这里就有洞察了。</div>;
  }

  const rejectRate = reject / judged;

  // 劝退率趋势：每天 reject /（当天三种裁决之和）
  const rateDaily = daily.map((d) => {
    const sum = (d.verdict_worth_doing || 0) + (d.verdict_defer || 0) + (d.verdict_reject || 0);
    return { date: d.date, rate: sum ? (d.verdict_reject || 0) / sum : 0, sum };
  });
  const maxRate = Math.max(0.01, ...rateDaily.map((d) => d.rate));

  // 最常被劝退的行业（按 reject 数降序，取前 5）
  const topRejected = [...(categories || [])]
    .filter((c) => c.reject > 0)
    .sort((a, b) => b.reject - a.reject)
    .slice(0, 5);
  const maxReject = Math.max(1, ...topRejected.map((c) => c.reject));

  const topCat = topRejected[0];

  return (
    <div className="judge-insights">
      <div className="judge-top">
        <div className="judge-rate">
          <div className="judge-rate-value">{Math.round(rejectRate * 100)}%</div>
          <div className="judge-rate-label">劝退率</div>
          <div className="judge-rate-sub">共评估 {judged} 次，劝退 {reject} 次</div>
        </div>
        <p className="judge-insight-text">
          裁决官对 {judged} 个业务场景做了评估，其中 <b>{reject}</b> 个被判「不建议用 AI」
          （{Math.round(rejectRate * 100)}%）。
          {topCat && <> 最想硬上 AI、却最常被劝退的是 <b>{catLabel(topCat.category)}</b> 类场景。</>}
          敢劝退，正是它区别于"什么都鼓励用 AI"的工具的地方。
        </p>
      </div>

      <div className="judge-cols">
        <div className="judge-col">
          <div className="judge-col-title">劝退率趋势</div>
          <svg className="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="劝退率趋势">
            {rateDaily.map((d, i) => {
              const bw = (100 - 2 * (rateDaily.length - 1)) / rateDaily.length;
              const h = d.sum > 0 ? Math.max(1.5, (d.rate / maxRate) * 44) : 0;
              return (
                <rect key={d.date} x={i * (bw + 2)} y={44 - h} width={bw} height={h} rx={0.6}
                  className="trend-bar judge-bar">
                  <title>{`${d.date}：劝退率 ${Math.round(d.rate * 100)}%（${d.sum} 次裁决）`}</title>
                </rect>
              );
            })}
          </svg>
          <div className="trend-axis">
            <span>{shortDate(daily[0].date)}</span>
            <span>{shortDate(daily[daily.length - 1].date)}</span>
          </div>
        </div>

        <div className="judge-col">
          <div className="judge-col-title">最常被劝退的行业</div>
          {topRejected.length === 0 ? (
            <div className="verdict-empty">暂无足够数据</div>
          ) : (
            <div className="cat-list">
              {topRejected.map((c) => (
                <div key={c.category} className="cat-row">
                  <span className="cat-name">{catLabel(c.category)}</span>
                  <span className="cat-bar-wrap">
                    <span className="cat-bar" style={{ width: `${(c.reject / maxReject) * 100}%` }} />
                  </span>
                  <span className="cat-meta">
                    <b>{c.reject}</b> 次 · {Math.round(c.rejectRate * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** total 里所有累计计数之和为 0 → 视为"还没有真实数据" */
function isEmptyTotal(total) {
  if (!total) return true;
  // 判据是"核心业务数据"是否为空——对话与裁决。
  // 只有几个 PV（自己访问带来的）不算真正有运营；那种"PV=6 其余全 0"的中间态
  // 展示效果反而最差，不如走演示形态。真正聊过/评估过之后自然切回真实数据。
  const core = ["chats", "verdict_worth_doing", "verdict_defer", "verdict_reject"];
  return core.every((k) => !Number(total[k]));
}

/** 运营看板主体（公开只读） */
export default function MetricsDashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok
  const [isDemo, setIsDemo] = useState(false);
  const [days, setDays] = useState(14);

  const load = useCallback(async (span) => {
    setStatus("loading");
    const showDemo = () => {
      setData(buildDemoData(span));
      setIsDemo(true);
      setStatus("ok");
    };
    try {
      const resp = await fetch(`/api/metrics?days=${span}`);
      const json = await resp.json().catch(() => null);
      // 没配 KV / 读取失败 / 有 KV 但还没积累出数据 → 一律回退到示例，避免空看板
      if (!resp.ok || !json || json.available === false || isEmptyTotal(json.total)) {
        showDemo();
        return;
      }
      setData(json);
      setIsDemo(false);
      setStatus("ok");
    } catch {
      showDemo(); // 网络异常也给示例，而不是报错页
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  if (status === "loading") return <div className="metrics-msg">加载运营数据中…</div>;

  const { total, daily } = data;

  return (
    <div className="metrics">
      {isDemo && (
        <div className="demo-banner">
          <span className="demo-badge">演示数据</span>
          以下为演示数据，仅用于展示看板形态。产生真实对话与裁决后，这里会自动切换为实时统计。
        </div>
      )}
      <div className="metrics-groups">
        <div className="metric-group">
          <div className="metric-group-title">流量</div>
          <div className="metrics-cards">
            <StatCard label="浏览量 PV" value={fmt(total.pv)} sub={`独立访客 ${fmt(total.uv)}`} accent="#4a8fb8" />
          </div>
        </div>

        <div className="metric-group">
          <div className="metric-group-title">使用</div>
          <div className="metrics-cards">
            <StatCard label="对话数" value={fmt(total.chats)} accent="#6BA88E" />
            <StatCard label="Token 消耗" value={fmt(total.tokens)} accent="#8a7bc8" />
            <StatCard label="工具调用" value={fmt(total.toolCalls)} accent="#E8915B" />
            <StatCard label="转交次数" value={fmt(total.handoffs)} accent="#c98bb0" />
          </div>
        </div>

        <div className="metric-group judge-group">
          <div className="metric-group-title">🧭 裁决官<span className="metric-group-tag">核心能力</span></div>
          <div className="metrics-cards">
            <StatCard
              label="裁决评估"
              value={fmt((total.verdict_worth_doing || 0) + (total.verdict_defer || 0) + (total.verdict_reject || 0))}
              accent="#c0a15f"
            />
            <StatCard
              label="劝退"
              value={fmt(total.verdict_reject || 0)}
              sub={(() => {
                const j = (total.verdict_worth_doing || 0) + (total.verdict_defer || 0) + (total.verdict_reject || 0);
                return j ? `劝退率 ${Math.round((total.verdict_reject || 0) / j * 100)}%` : "暂无";
              })()}
              accent="#c45c4a"
            />
          </div>
        </div>
      </div>

      <div className="metrics-section">
        <div className="metrics-section-head">
          <h3>每日趋势</h3>
          <div className="days-switch">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                className={`days-btn${days === d ? " active" : ""}`}
                onClick={() => setDays(d)}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>
        <div className="trend-grid">
          <TrendBars daily={daily} field="pv" label="浏览量 PV" />
          <TrendBars daily={daily} field="chats" label="对话数" />
          <TrendBars daily={daily} field="tokens" label="Token" />
        </div>
      </div>

      <div className="metrics-section">
        <div className="metrics-section-head"><h3>裁决结果分布</h3></div>
        <VerdictBar total={total} />
      </div>

      <div className="metrics-section">
        <div className="metrics-section-head">
          <h3>🧭 裁决官洞察</h3>
          <span className="section-tag">敢劝退，才是价值</span>
        </div>
        <JudgeInsights total={total} daily={daily} categories={data.categories} />
      </div>

      <p className="metrics-foot">
        {isDemo
          ? "以上为演示数据，仅展示看板形态。真实统计口径：PV 每次载入 +1，UV 按浏览器匿名 id 去重（HyperLogLog），存于 Vercel KV。"
          : `统计口径：PV 每次载入 +1，UV 按浏览器匿名 id 去重；数据存于 Vercel KV，起始于 ${data.firstDay}。`}
      </p>
    </div>
  );
}
