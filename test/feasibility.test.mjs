// 裁决报告解析：行业 category 规范化
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFeasibilityReport,
  normalizeCategory,
  CATEGORY_IDS,
  CATEGORY_LABELS,
} from "../api/_feasibility.js";

test("normalizeCategory 命中枚举取之，否则归 other", () => {
  assert.equal(normalizeCategory("legal"), "legal");
  assert.equal(normalizeCategory("RETAIL"), "retail"); // 大小写不敏感
  assert.equal(normalizeCategory("  medical "), "medical"); // 去空白
  assert.equal(normalizeCategory("bogus"), "other");
  assert.equal(normalizeCategory(""), "other");
  assert.equal(normalizeCategory(undefined), "other");
  assert.equal(normalizeCategory(123), "other");
});

test("每个 category id 都有对应中文标签", () => {
  for (const id of CATEGORY_IDS) {
    assert.equal(typeof CATEGORY_LABELS[id], "string");
    assert.ok(CATEGORY_LABELS[id].length > 0);
  }
});

test("parseFeasibilityReport 输出规范化后的 category 与 categoryLabel", () => {
  const raw = {
    verdict: "reject",
    category: "legal",
    gate1: { dimensions: [{ id: "taskFit", score: 2, reason: "法律责任重" }] },
    gate2: { dimensions: [{ id: "roi", score: 2, reason: "投入大" }] },
  };
  const report = parseFeasibilityReport(raw);
  assert.equal(report.category, "legal");
  assert.equal(report.categoryLabel, "法律");
});

test("非法 category 落到 other", () => {
  const report = parseFeasibilityReport({ verdict: "defer", category: "spaceships" });
  assert.equal(report.category, "other");
  assert.equal(report.categoryLabel, CATEGORY_LABELS.other);
});

test("缺 category 字段也不报错，归 other", () => {
  const report = parseFeasibilityReport({ verdict: "worth_doing" });
  assert.equal(report.category, "other");
});
