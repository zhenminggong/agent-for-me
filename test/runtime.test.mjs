// 运行时拼装：时区感知与 handoff 标记剥离
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleSupplement,
  buildSkillsSupplement,
  wallClockFromEpoch,
  splitStreamSafe,
  parseHandoffMarker,
} from "../api/_runtime.js";

const schedule = {
  rhythm: "gentle",
  dailyReminders: [
    { time: "08:00", label: "早安问候" },
    { time: "21:00", label: "睡前陪伴" },
  ],
  careTopics: ["饮食休息"],
};

// ---------------------------------------------------------------- 时区
// 生产跑在 UTC，历史上这里按服务器时区读 clientTime，东八区用户整体偏 8 小时。

test("本地墙上时钟按字面取值，不受服务端时区影响", () => {
  const s = buildScheduleSupplement(schedule, "2026-07-16T21:30", 480);
  assert.match(s, /当前用户本地时间：2026-07-16 21:30/);
  assert.match(s, /⚠ 当前接近的提醒：21:00 睡前陪伴/);
});

test("UTC ISO + tzOffset 可还原为用户本地时间", () => {
  const s = buildScheduleSupplement(schedule, "2026-07-16T13:30:00.000Z", 480);
  assert.match(s, /当前用户本地时间：2026-07-16 21:30/);
});

test("绝对时刻但缺 tzOffset 时不注入时间（宁可没有也不能给错的）", () => {
  const s = buildScheduleSupplement(schedule, "2026-07-16T13:30:00.000Z", undefined);
  assert.doesNotMatch(s, /当前用户本地时间/);
});

test("HH:mm 短格式命中提醒", () => {
  assert.match(buildScheduleSupplement(schedule, "08:10", 480), /⚠ 当前接近的提醒：08:00 早安问候/);
});

test("提醒窗口跨午夜环绕", () => {
  const s = buildScheduleSupplement({ dailyReminders: [{ time: "00:00", label: "午夜" }] }, "23:45", 480);
  assert.match(s, /⚠ 当前接近的提醒：00:00 午夜/);
});

test("非法时间输入不注入", () => {
  for (const bad of ["not-a-time", "25:00", "99:99", ""]) {
    assert.doesNotMatch(buildScheduleSupplement(schedule, bad, 480), /当前用户本地时间/, `input=${bad}`);
  }
});

test("wallClockFromEpoch 跨日与负偏移", () => {
  assert.equal(wallClockFromEpoch(Date.parse("2026-07-16T17:00:00Z"), 480).dateStr, "2026-07-17 01:00");
  assert.equal(wallClockFromEpoch(Date.parse("2026-07-16T02:00:00Z"), -420).dateStr, "2026-07-15 19:00");
});

// ---------------------------------------------------------------- 技能段

test("真工具与 prompt 级技能分区呈现", () => {
  const s = buildSkillsSupplement([
    { name: "算数", icon: "🧮", tool: "calculator" },
    { name: "共情", icon: "💚" },
  ]);
  assert.match(s, /### 可执行工具/);
  assert.match(s, /算数.*可调用函数 `calculator`/);
  assert.match(s, /### 行事风格技能/);
  assert.match(s, /- 💚 共情/);
});

test("无技能返回空串", () => {
  assert.equal(buildSkillsSupplement([]), "");
  assert.equal(buildSkillsSupplement(undefined), "");
});

// ---------------------------------------------------------------- 流式标记扣留
// [HANDOFF:...] 对用户不可见；流式下逐字到达，扣不住就会被用户看见。

test("普通文本与正文中括号照常下发", () => {
  assert.deepEqual(splitStreamSafe("你好"), ["你好", ""]);
  assert.deepEqual(splitStreamSafe("见 [注1] 说明"), ["见 [注1] 说明", ""]);
  assert.deepEqual(splitStreamSafe("价格 [1"), ["价格 [1", ""]);
});

test("半截与完整标记均扣住", () => {
  assert.deepEqual(splitStreamSafe("好的 [HAND"), ["好的 ", "[HAND"]);
  assert.deepEqual(splitStreamSafe("好的 [HANDOFF:a:b]"), ["好的 ", "[HANDOFF:a:b]"]);
});

test("回归：正文有普通中括号在前时，末尾标记仍须扣住", () => {
  // 曾用 lastIndexOf 定位，会选中 [注1] 之后的位置从而把标记原样吐给用户
  assert.deepEqual(
    splitStreamSafe("见 [注1] 好的 [HANDOFF:advisor:理由]"),
    ["见 [注1] 好的 ", "[HANDOFF:advisor:理由]"]
  );
});

test("标记后仍有正文时一并扣住，等收尾重排", () => {
  assert.deepEqual(
    splitStreamSafe("好的 [HANDOFF:a:b]\n补充"),
    ["好的 ", "[HANDOFF:a:b]\n补充"]
  );
});

/** 模拟逐字流式，返回用户实际看到的内容 */
function simulate(fullText, links, chunks) {
  let held = "", emitted = "", raw = "";
  for (const piece of chunks || [...fullText]) {
    raw += piece;
    const [safe, tail] = splitStreamSafe(held + piece);
    held = tail;
    emitted += safe;
  }
  const { reply: cleaned, handoff } = parseHandoffMarker(raw, links);
  return { userSaw: emitted + cleaned.slice(emitted.length), handoff, emitted };
}

const links = [{ targetId: "advisor", label: "转交裁决官" }];

test("端到端：流式期间不泄漏标记，收尾产出 handoff", () => {
  const r = simulate("我理解。这个更适合裁决官。\n[HANDOFF:advisor:需要裁决]", links);
  assert.doesNotMatch(r.emitted, /\[HAND/);
  assert.equal(r.userSaw.trim(), "我理解。这个更适合裁决官。");
  assert.equal(r.handoff.targetId, "advisor");
  assert.equal(r.handoff.label, "转交裁决官");
});

test("端到端：正文含 Markdown 链接与中括号时完整通过", () => {
  const md = "参考 [文档](https://x.com) 和 [注1]：\n\n- **要点**\n";
  assert.equal(simulate(md, links).userSaw.trim(), md.trim());
});

test("端到端：标记跨 SSE 分块到达也不泄漏", () => {
  const r = simulate(null, links, ["我理解。", "这个更适合裁", "决官。\n[HANDOFF:ad", "visor:需要裁决]"]);
  assert.doesNotMatch(r.emitted, /HANDOFF/);
  assert.equal(r.userSaw.trim(), "我理解。这个更适合裁决官。");
});

test("端到端：未知 targetId 剥离标记但不产出 handoff", () => {
  const r = simulate("好的。\n[HANDOFF:nonexistent:瞎转]", links);
  assert.equal(r.userSaw.trim(), "好的。");
  assert.equal(r.handoff, null);
});
