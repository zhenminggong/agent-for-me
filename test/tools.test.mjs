// 工具注册表：计算器求值安全性、工具执行兜底、定义构建
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evalArithmetic,
  executeTool,
  buildToolDefinitions,
  describeTool,
  listAvailableTools,
  TOOL_REGISTRY,
} from "../api/_tools.js";

// ---------------------------------------------------------------- 计算器

test("四则运算与优先级", () => {
  const cases = [
    ["1+1", 2], ["2+3*4", 14], ["(2+3)*4", 20], ["10/4", 2.5],
    ["2^10", 1024], ["2^3^2", 512], // ^ 右结合
    ["-5+3", -2], ["-(2+3)", -5], ["10%3", 1],
    ["(1200*12-3000)/8", 1425], ["1.5*4", 6], ["--3", 3],
  ];
  for (const [expr, want] of cases) {
    assert.equal(evalArithmetic(expr), want, `expr=${expr}`);
  }
});

// 表达式来自模型输出 = 不可信输入。用 eval/Function 就是把执行权交出去。
test("拒绝一切非算术输入", () => {
  const rejects = [
    "process.exit(1)", "require('fs')", "1+1; console.log(1)",
    "constructor", "alert(1)", "__proto__", "globalThis",
    "1/0", "(1+2", "1+", "", "abc",
  ];
  for (const bad of rejects) {
    assert.throws(() => evalArithmetic(bad), undefined, `应拒绝: ${JSON.stringify(bad)}`);
  }
});

test("注入尝试不产生副作用", () => {
  globalThis.__pwned = false;
  assert.throws(() => evalArithmetic("globalThis.__pwned=true"));
  assert.equal(globalThis.__pwned, false);
  delete globalThis.__pwned;
});

// ---------------------------------------------------------------- executeTool
// 工具失败必须返回 { error } 交回模型，而不是抛出去中断整轮对话。

test("计算器工具返回结果", async () => {
  const r = await executeTool("calculator", '{"expression":"(1200*12-3000)/8"}', {});
  assert.equal(r.result, 1425);
});

test("各类失败都收敛为 error 字段", async () => {
  assert.match((await executeTool("calculator", '{"expression":"1/0"}', {})).error, /除数/);
  assert.equal((await executeTool("calculator", "not json", {})).error, "参数不是合法 JSON");
  assert.match((await executeTool("nope", "{}", {})).error, /未知工具/);
});

test("get_current_time 时区正确", async () => {
  const cn = await executeTool("get_current_time", "{}", { tzOffset: 480 });
  const utc = await executeTool("get_current_time", "{}", { tzOffset: 0 });
  assert.match(cn.timeOfDay, /^([01]\d|2[0-3]):[0-5]\d$/);
  assert.match(cn.weekday, /^周[日一二三四五六]$/);
  assert.equal(cn.tzOffset, 480);
  const hour = (s) => Number(s.timeOfDay.split(":")[0]);
  assert.equal((hour(cn) - hour(utc) + 24) % 24, 8, "东八区应比 UTC 快 8 小时");
});

test("list_agents 返回工作台清单", async () => {
  const r = await executeTool("list_agents", "{}", {
    allAgents: [{ id: "a", name: "甲", tagline: "t", skills: [{ name: "s1" }] }],
  });
  assert.equal(r.count, 1);
  assert.deepEqual(r.agents[0].skills, ["s1"]);
});

test("工具卡死时超时兜底（故障注入）", async () => {
  const saved = TOOL_REGISTRY.calculator.run;
  TOOL_REGISTRY.calculator.run = () => new Promise((r) => setTimeout(r, 9000));
  try {
    const started = Date.now();
    const r = await executeTool("calculator", "{}", {});
    assert.match(r.error, /超时/);
    assert.ok(Date.now() - started < 7000, "应在 5s 左右返回而非挂死");
  } finally {
    TOOL_REGISTRY.calculator.run = saved;
  }
});

// ---------------------------------------------------------------- 定义构建

test("只为绑定了已知工具的技能建定义，并去重", () => {
  const skills = [
    { id: "a", name: "算数", tool: "calculator" },
    { id: "b", name: "共情" },                     // 无 tool → prompt 级
    { id: "c", name: "又算数", tool: "calculator" }, // 重复 → 去重
    { id: "d", name: "坏的", tool: "no_such_tool" }, // 未知 → 忽略
  ];
  const defs = buildToolDefinitions(skills);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].function.name, "calculator");
  assert.equal(defs[0].type, "function");
  assert.ok(defs[0].function.parameters);
  assert.equal(buildToolDefinitions(undefined).length, 0);
});

test("describeTool 取技能展示名，未知则回退函数名", () => {
  const skills = [{ name: "算数", icon: "🧮", tool: "calculator" }];
  assert.equal(describeTool(skills, "calculator").name, "算数");
  assert.equal(describeTool(skills, "calculator").icon, "🧮");
  assert.equal(describeTool(skills, "get_current_time").name, "get_current_time");
});

test("listAvailableTools 暴露注册表全量", () => {
  const tools = listAvailableTools();
  assert.equal(tools.length, Object.keys(TOOL_REGISTRY).length);
  assert.ok(tools.every((t) => t.name && t.description));
});
