import {
  VERDICT_META,
  CONFIDENCE_LABELS,
  scoreTone,
  scorePercent,
  REASON_PLACEHOLDER,
} from "./feasibilityReport.js";

/**
 * 单条维度得分行 — 始终展示 reason，空则显示占位提示
 * @param {{ label: string, score: number, reason: string }} dimension
 */
function DimensionRow({ dimension }) {
  const tone = scoreTone(dimension.score);
  const hasReason = Boolean(dimension.reason?.trim());

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
      <p
        className={`fv-dimension-reason${hasReason ? "" : " fv-dimension-reason-empty"}`}
      >
        {hasReason ? dimension.reason : REASON_PLACEHOLDER}
      </p>
    </div>
  );
}

/**
 * 闸门区块（闸门一 / 闸门二）— gate summary 置于标题下方突出展示
 * @param {{ title: string, gate: object, passedLabel: string, failedLabel: string }} props
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
      {gate.summary ? (
        <p className="fv-gate-summary fv-gate-summary-prominent">{gate.summary}</p>
      ) : (
        <p className="fv-gate-summary fv-gate-summary-missing">
          （该闸门缺少总结说明）
        </p>
      )}
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
 * 判断 summary 是否与 verdictLabel 实质相同（避免重复展示）
 * @param {string} summary
 * @param {string} verdictLabel
 * @returns {boolean}
 */
function isSummarySameAsVerdict(summary, verdictLabel) {
  if (!summary || !verdictLabel) return false;
  const norm = (s) => s.replace(/[\s，。！？、；：""''（）]/g, "");
  return norm(summary) === norm(verdictLabel);
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
  const labelText = report.verdictLabel || meta.label;
  const showSummary =
    report.summary && !isSummarySameAsVerdict(report.summary, labelText);
  const hasWarnings =
    (report.warnings && report.warnings.length > 0) || report.lowQuality;

  return (
    <div className="feasibility-verdict">
      {hasWarnings ? (
        <div className="fv-quality-banner" role="status">
          {report.warnings?.map((msg, i) => (
            <p key={i}>{msg}</p>
          ))}
          {report.lowQuality && !report.warnings?.length ? (
            <p>评估细节不足，建议补充业务场景信息后重新提问。</p>
          ) : null}
        </div>
      ) : null}

      <header className={`fv-verdict-banner tone-${meta.tone}`}>
        <div className="fv-verdict-main">
          <span className="fv-verdict-tag">{labelText}</span>
          {showSummary ? (
            <p className="fv-verdict-summary">{report.summary}</p>
          ) : null}
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
