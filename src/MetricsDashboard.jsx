import { useState, useEffect, useCallback } from "react";
import { adminFetch } from "./adminAuth.js";

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

/** 运营看板主体 */
export default function MetricsDashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | unavailable | error
  const [days, setDays] = useState(14);

  const load = useCallback(async (span) => {
    setStatus("loading");
    try {
      const resp = await adminFetch(`/api/metrics?days=${span}`);
      const json = await resp.json();
      if (!resp.ok) {
        setStatus("error");
        return;
      }
      if (json.available === false) {
        setStatus("unavailable");
        return;
      }
      setData(json);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  if (status === "loading") return <div className="metrics-msg">加载运营数据中…</div>;
  if (status === "unavailable")
    return (
      <div className="metrics-msg">
        未配置 Vercel KV，暂无运营数据。配置 KV 后，浏览量、对话量、token 等会自动开始累计。
      </div>
    );
  if (status === "error" || !data)
    return (
      <div className="metrics-msg">
        读取失败。<button className="link-btn" onClick={() => load(days)}>重试</button>
      </div>
    );

  const { total, daily } = data;

  return (
    <div className="metrics">
      <div className="metrics-cards">
        <StatCard label="浏览量 PV" value={fmt(total.pv)} sub={`独立访客 ${fmt(total.uv)}`} accent="#4a8fb8" />
        <StatCard label="对话数" value={fmt(total.chats)} accent="#6BA88E" />
        <StatCard label="Token 消耗" value={fmt(total.tokens)} accent="#8a7bc8" />
        <StatCard label="工具调用" value={fmt(total.toolCalls)} accent="#E8915B" />
        <StatCard label="转交次数" value={fmt(total.handoffs)} accent="#c98bb0" />
        <StatCard
          label="裁决评估"
          value={fmt((total.verdict_worth_doing || 0) + (total.verdict_defer || 0) + (total.verdict_reject || 0))}
          accent="#c0a15f"
        />
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

      <p className="metrics-foot">
        统计口径：PV 每次载入 +1，UV 按浏览器匿名 id 去重；数据存于 Vercel KV，
        起始于 {data.firstDay}。
      </p>
    </div>
  );
}
