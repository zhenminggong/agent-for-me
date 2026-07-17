/**
 * AI 可行性裁决 — 结构化 JSON 解析与校验
 * 供 /api/chat 在 advisor Agent 返回后规范化数据。
 */

const VERDICT_LABELS = {
  worth_doing: "能做且值得",
  defer: "能做但不值",
  reject: "不建议用 AI",
};

const DIMENSION_IDS = [
  "taskFit",
  "dataReady",
  "riskTolerance",
  "frequencyScale",
  "roi",
  "alternativeCost",
];

/**
 * 业务场景行业分类（固定枚举）。
 * 让裁决官在结构化输出里顺手给出 category，用于运营看板按行业统计"劝退率"。
 * 用固定 id 而非自由文本，才能聚合；识别不出时归入 other。
 */
const CATEGORY_LABELS = {
  retail: "零售/电商",
  food: "餐饮",
  education: "教育",
  legal: "法律",
  medical: "医疗健康",
  finance: "金融",
  manufacturing: "制造/工业",
  content: "内容/营销",
  service: "客服/服务",
  hr: "人力/行政",
  logistics: "物流/供应链",
  other: "其他",
};

const CATEGORY_IDS = Object.keys(CATEGORY_LABELS);

/**
 * 规范化模型给的 category：命中枚举取之，否则归 other。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCategory(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CATEGORY_IDS.includes(v) ? v : "other";
}

/** 六维 reason 为空时，前端展示的占位文案 */
const REASON_PLACEHOLDER = "（需补充场景信息后再评估）";

/**
 * 从模型原始文本中提取 JSON 对象
 * @param {string} raw
 * @returns {object|null}
 */
function extractJsonObject(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 将单项得分限制在 1–5
 * @param {unknown} value
 * @returns {number}
 */
function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/**
 * 规范化维度数组
 * @param {unknown} dimensions
 * @param {Array<{id:string,label:string}>} template
 */
function normalizeDimensions(dimensions, template) {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const byId = Object.fromEntries(list.map((d) => [d?.id, d]));

  return template.map(({ id, label }) => {
    const item = byId[id] || {};
    return {
      id,
      label: typeof item.label === "string" && item.label.trim() ? item.label : label,
      score: clampScore(item.score),
      reason: typeof item.reason === "string" ? item.reason.trim() : "",
    };
  });
}

/**
 * 判断六维得分是否完全相同
 * @param {Array<{score:number}>} dimensions
 * @returns {boolean}
 */
function allScoresIdentical(dimensions) {
  if (!dimensions.length) return false;
  const first = dimensions[0].score;
  return dimensions.every((d) => d.score === first);
}

/**
 * 统计 reason 为空的维度数量
 * @param {Array<{reason:string}>} dimensions
 * @returns {number}
 */
function countEmptyReasons(dimensions) {
  return dimensions.filter((d) => !d.reason).length;
}

/**
 * 用闸门 summary 为空的 dimension reason 做兜底填充
 * @param {Array<{reason:string}>} dimensions
 * @param {string} gateSummary
 */
function fillEmptyReasonsFromGateSummary(dimensions, gateSummary) {
  if (!gateSummary) return;
  for (const dim of dimensions) {
    if (!dim.reason) {
      dim.reason = gateSummary.slice(0, 50);
    }
  }
}

/**
 * 判断 summary 是否与 verdictLabel 实质重复
 * @param {string} summary
 * @param {string} verdictLabel
 * @returns {boolean}
 */
function summaryDuplicatesVerdict(summary, verdictLabel) {
  const norm = (s) => s.replace(/[\s，。！？、；：""''（）]/g, "").toLowerCase();
  return norm(summary) === norm(verdictLabel);
}

/**
 * 校验并规范化完整裁决报告
 * @param {unknown} raw
 * @returns {object|null}
 */
export function parseFeasibilityReport(raw) {
  const data = typeof raw === "string" ? extractJsonObject(raw) : raw;
  if (!data || typeof data !== "object") return null;

  const verdict = ["worth_doing", "defer", "reject"].includes(data.verdict)
    ? data.verdict
    : "defer";

  const gate1Template = [
    { id: "taskFit", label: "任务匹配度" },
    { id: "dataReady", label: "数据就绪度" },
    { id: "riskTolerance", label: "容错与安全" },
    { id: "frequencyScale", label: "频次与标准化" },
  ];

  const gate2Template = [
    { id: "roi", label: "投入产出比" },
    { id: "alternativeCost", label: "相对替代方案" },
  ];

  const gate1Dims = normalizeDimensions(data.gate1?.dimensions, gate1Template);
  const gate2Dims = normalizeDimensions(data.gate2?.dimensions, gate2Template);
  const allDims = [...gate1Dims, ...gate2Dims];

  const gate1Summary =
    typeof data.gate1?.summary === "string" ? data.gate1.summary.trim() : "";
  const gate2Summary =
    typeof data.gate2?.summary === "string" ? data.gate2.summary.trim() : "";

  // 尝试用闸门 summary 补全空的 dimension reason
  fillEmptyReasonsFromGateSummary(gate1Dims, gate1Summary);
  fillEmptyReasonsFromGateSummary(gate2Dims, gate2Summary);

  const gate1Avg =
    gate1Dims.reduce((sum, d) => sum + d.score, 0) / gate1Dims.length;
  const gate2Avg =
    gate2Dims.reduce((sum, d) => sum + d.score, 0) / gate2Dims.length;

  const gate1Passed =
    typeof data.gate1?.passed === "boolean"
      ? data.gate1.passed
      : gate1Avg >= 3 && gate1Dims.every((d) => d.score >= 2);

  const gate2Passed =
    typeof data.gate2?.passed === "boolean"
      ? data.gate2.passed
      : gate2Avg >= 3;

  const toList = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => s.trim())
      .slice(0, 5);

  const verdictLabel =
    typeof data.verdictLabel === "string" && data.verdictLabel.trim()
      ? data.verdictLabel.trim()
      : VERDICT_LABELS[verdict];

  let summary =
    typeof data.summary === "string" && data.summary.trim()
      ? data.summary.trim()
      : VERDICT_LABELS[verdict];

  // summary 与 verdictLabel 重复时，拼接 gate1 说明以提供实质内容
  if (summaryDuplicatesVerdict(summary, verdictLabel) && gate1Summary) {
    summary = `${gate1Summary}${gate2Summary ? `；${gate2Summary}` : ""}`;
  }

  const warnings = [];
  const identicalScores = allScoresIdentical(allDims);
  if (identicalScores) {
    warnings.push("六维得分完全相同，评估可能缺乏针对性，建议补充场景细节后重新评估。");
  }

  const emptyReasonCount = countEmptyReasons(allDims);
  const lowQuality = identicalScores || emptyReasonCount > 2;

  const category = normalizeCategory(data.category);

  return {
    verdict,
    verdictLabel,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    confidence: ["low", "medium", "high"].includes(data.confidence)
      ? data.confidence
      : "medium",
    summary,
    gate1: {
      passed: gate1Passed,
      summary: gate1Summary,
      averageScore: Math.round(gate1Avg * 10) / 10,
      dimensions: gate1Dims,
    },
    gate2: {
      passed: gate2Passed,
      summary: gate2Summary,
      averageScore: Math.round(gate2Avg * 10) / 10,
      dimensions: gate2Dims,
    },
    overallScore:
      Math.round(
        (allDims.reduce((sum, d) => sum + d.score, 0) / allDims.length) * 10
      ) / 10,
    risks: toList(data.risks),
    alternatives: toList(data.alternatives),
    questions: toList(data.questions),
    nextSteps: toList(data.nextSteps),
    warnings: warnings.length ? warnings : undefined,
    lowQuality: lowQuality || undefined,
  };
}

/**
 * 生成纯文本摘要（结构化解析失败时的兜底展示）
 * @param {object} report
 * @returns {string}
 */
export function buildFeasibilitySummary(report) {
  const lines = [
    `【${report.verdictLabel}】${report.summary}`,
    "",
    `综合得分：${report.overallScore}/5`,
  ];
  if (report.gate1.summary) lines.push("", `闸门一：${report.gate1.summary}`);
  if (report.gate2.summary) lines.push(`闸门二：${report.gate2.summary}`);
  if (report.nextSteps.length) {
    lines.push("", "建议下一步：");
    report.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  return lines.join("\n");
}

/** DashScope json_object 模式要求 messages 中须出现 json 字样 */
const JSON_OUTPUT_HINT = "你必须以 JSON 对象格式输出（json）。";

/**
 * 确保 messages 中含 json 关键字（DashScope response_format=json_object 硬性要求）
 * @param {Array<{role:string, content:string}>} messages
 * @returns {Array<{role:string, content:string}>}
 */
export function ensureJsonHintInMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const hasJson = messages.some(
    (m) => typeof m?.content === "string" && /json/i.test(m.content)
  );
  if (hasJson) return messages;

  const cloned = messages.map((m) => ({ ...m }));
  const systemIdx = cloned.findIndex((m) => m.role === "system");

  if (systemIdx >= 0) {
    cloned[systemIdx] = {
      ...cloned[systemIdx],
      content: `${cloned[systemIdx].content}\n\n${JSON_OUTPUT_HINT}`,
    };
  } else {
    cloned.unshift({ role: "system", content: JSON_OUTPUT_HINT });
  }

  return cloned;
}

export { VERDICT_LABELS, DIMENSION_IDS, REASON_PLACEHOLDER, CATEGORY_LABELS, CATEGORY_IDS, normalizeCategory };
