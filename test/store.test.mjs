// 数据层迁移：新 seed agent 上架、新增 handoff 链接合并、不覆盖用户编辑
// 跑：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { listAgents, __setKvForTest } from "../api/_store.js";
import { SEED_AGENTS } from "../api/_seed.js";

/** 内存版假 KV，只需 get/set */
function fakeKv(initial) {
  const store = new Map();
  if (initial !== undefined) store.set("agents:list", initial);
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { store.set(k, v); return "OK"; },
  };
}

/** 造一个"旧的" KV：只有 advisor + companion（模拟线上已有数据） */
function oldTwoAgents() {
  const advisor = structuredClone(SEED_AGENTS.find((a) => a.id === "advisor"));
  const companion = structuredClone(SEED_AGENTS.find((a) => a.id === "companion"));
  // 去掉 advisor 指向 prompt-engineer 的新链接，模拟"加新 agent 之前"的状态
  advisor.agentLinks = advisor.agentLinks.filter((l) => l.targetId !== "prompt-engineer");
  return [advisor, companion];
}

test("KV 里缺失的新 seed agent 会随读取自动上架", async () => {
  const kv = fakeKv(oldTwoAgents());
  __setKvForTest(kv);
  try {
    const { agents } = await listAgents();
    const ids = agents.map((a) => a.id);
    assert.ok(ids.includes("prompt-engineer"), `应包含 prompt-engineer，实际：${ids.join(",")}`);
    // 且已写回 KV
    assert.ok(kv.store.get("agents:list").some((a) => a.id === "prompt-engineer"));
  } finally {
    __setKvForTest(null);
  }
});

test("advisor 新增的 prompt-engineer handoff 链接被追加，且不丢原有 companion 链接", async () => {
  const kv = fakeKv(oldTwoAgents());
  __setKvForTest(kv);
  try {
    const { agents } = await listAgents();
    const advisor = agents.find((a) => a.id === "advisor");
    const targets = advisor.agentLinks.map((l) => l.targetId);
    assert.ok(targets.includes("companion"), "原 companion 链接应保留");
    assert.ok(targets.includes("prompt-engineer"), "新 prompt-engineer 链接应追加");
  } finally {
    __setKvForTest(null);
  }
});

test("不覆盖用户对已有 agent 的编辑（在 companion 上验证，它无强制迁移）", async () => {
  // 注：advisor 有 needsAdvisorMigration 的整体强制升级逻辑（开场白须含「两道闸门」），
  // 属既有设计，不在此测。这里用 companion 验证增量合并不会清掉用户编辑。
  const edited = oldTwoAgents();
  const companion = edited.find((a) => a.id === "companion");
  companion.greeting = "我的自定义开场白";
  const kv = fakeKv(edited);
  __setKvForTest(kv);
  try {
    const { agents } = await listAgents();
    const c = agents.find((a) => a.id === "companion");
    assert.equal(c.greeting, "我的自定义开场白");
  } finally {
    __setKvForTest(null);
  }
});

test("已含全部 agent 且链接齐全时，读取幂等（不重复追加链接）", async () => {
  const full = structuredClone(SEED_AGENTS);
  const kv = fakeKv(full);
  __setKvForTest(kv);
  try {
    const { agents } = await listAgents();
    assert.equal(agents.length, SEED_AGENTS.length);
    const advisor = agents.find((a) => a.id === "advisor");
    const peLinks = advisor.agentLinks.filter((l) => l.targetId === "prompt-engineer");
    assert.equal(peLinks.length, 1, "prompt-engineer 链接不应重复");
  } finally {
    __setKvForTest(null);
  }
});

test("KV 为空时用 seed 初始化，含全部 agent", async () => {
  const kv = fakeKv(); // 无 agents:list
  __setKvForTest(kv);
  try {
    const { agents, editable } = await listAgents();
    assert.equal(editable, true);
    assert.equal(agents.length, SEED_AGENTS.length);
    assert.ok(agents.some((a) => a.id === "prompt-engineer"));
  } finally {
    __setKvForTest(null);
  }
});
