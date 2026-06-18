/**
 * 前端：裁决报告展示辅助（得分颜色、置信度文案等）
 */

export const VERDICT_META = {
  worth_doing: { label: "能做且值得", tone: "good" },
  defer: { label: "能做但不值", tone: "warn" },
  reject: { label: "不建议用 AI", tone: "bad" },
};

export const CONFIDENCE_LABELS = {
  low: "把握偏低 · 信息不足",
  medium: "把握中等 · 基于常见场景",
  high: "把握较高 · 场景较清晰",
};

/**
 * 根据 1–5 分返回展示用颜色档位
 * @param {number} score
 * @returns {'good'|'mid'|'bad'}
 */
export function scoreTone(score) {
  if (score >= 4) return "good";
  if (score >= 3) return "mid";
  return "bad";
}

/**
 * 计算得分条宽度百分比
 * @param {number} score
 * @returns {number}
 */
export function scorePercent(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 60;
  return Math.min(100, Math.max(20, (n / 5) * 100));
}
