import {
  VERDICT_META,
  CONFIDENCE_LABELS,
  scoreTone,
  scorePercent,
} from "./feasibilityReport.js";

/**
 * 单条维度得分行
 * @param {{ label: string, score: number, reason: string }} dimension
 */
function DimensionRow({ dimension }) {
  const tone = scoreTone(dimension.score);
  return (
    <div className="fv-dimension">
      <div className="fv-dimension-head">
        <span className="fv-dimension-label">{dimension.label}</span>
        <span className={`fv-dimension-score tone-${tone}`}>
          {dimension.score}/5
        </span>
      </div>
      <div className="fv-score-track">
        <div
          className={`fv-score-fill tone-${tone}`}
          style={{ width: `${scorePercent(dimension.score)}%` }}
        />
      </div>
      {dimension.reason ? (
        <p className="fv-dimension-reason">{dimension.reason}</p>
      ) : null}
    </div>
  );
}

/**
 * 闸门区块（闸门一 / 闸门二）
 * @param {{ title: string, gate: object, passed: boolean }} props
 */
function GateBlock({ title, gate, passedLabel, failedLabel }) {
  if (!gate) return null;
  return (
    <section className="fv-gate">
      <div className="fv-gate-head">
        <h4>{title}</h4>
        <span className={`fv-gate-badge ${gate.passed ? "pass" : "fail"}`}>
          {gate.passed ? passedLabel : failedLabel}
        </span>
        <span className="fv-gate-avg">均分 {gate.averageScore}/5</span>
      </div>
      {gate.summary ? <p className="fv-gate-summary">{gate.summary}</p> : null}
      <div className="fv-dimensions">
        {(gate.dimensions || []).map((d) => (
          <DimensionRow key={d.id} dimension={d} />
        ))}
      </div>
    </section>
  );
}

/**
 * 列表区块（风险 / 替代 / 追问 / 下一步）
 * @param {{ title: string, items: string[], variant?: string }} props
 */
function ListBlock({ title, items, variant = "default" }) {
  if (!items?.length) return null;
  return (
    <section className={`fv-list-block variant-${variant}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * AI 可行性裁决 — 结构化卡片展示
 * @param {{ report: object, fallbackText?: string }} props
 */
export default function FeasibilityVerdict({ report, fallbackText }) {
  if (!report) {
    return fallbackText ? (
      <div className="bubble plain-fallback">{fallbackText}</div>
    ) : null;
  }

  const meta = VERDICT_META[report.verdict] || VERDICT_META.defer;

  return (
    <div className="feasibility-verdict">
      <header className={`fv-verdict-banner tone-${meta.tone}`}>
        <div className="fv-verdict-main">
          <span className="fv-verdict-tag">{report.verdictLabel || meta.label}</span>
          <p className="fv-verdict-summary">{report.summary}</p>
        </div>
        <div className="fv-verdict-stats">
          <div className="fv-overall-score">
            <span className="fv-overall-num">{report.overallScore}</span>
            <span className="fv-overall-unit">/5</span>
          </div>
          <span className="fv-confidence">
            {CONFIDENCE_LABELS[report.confidence] || CONFIDENCE_LABELS.medium}
          </span>
        </div>
      </header>

      <GateBlock
        title="闸门一 · 能不能做"
        gate={report.gate1}
        passedLabel="通过"
        failedLabel="不通过"
      />
      <GateBlock
        title="闸门二 · 值不值得做"
        gate={report.gate2}
        passedLabel="值得"
        failedLabel="不值"
      />

      <ListBlock title="主要风险" items={report.risks} variant="risk" />
      <ListBlock title="更靠谱的替代思路" items={report.alternatives} variant="alt" />
      <ListBlock title="还需了解" items={report.questions} variant="ask" />
      <ListBlock title="建议下一步" items={report.nextSteps} variant="next" />
    </div>
  );
}
