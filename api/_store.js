// 数据层:封装 Agent 配置的读写。
// 优先用 Vercel KV(可编辑、热更新);没配 KV 时降级到种子配置(只读)。
// 这样:不配数据库也能跑(演示无障碍),配了数据库就能在线编辑 Agent。

import { SEED_AGENTS } from "./_seed.js";

const KEY = "agents:list"; // 存所有 Agent 配置的 key
const VERSIONS_PREFIX = "agent:versions:"; // 每个 agent 的历史版本
const ADVISOR_GREETING_MARK = "两道闸门";

/**
 * 判断 KV 里的 advisor 是否仍是旧版（无 structured 或开场白/ system 未升级）
 */
function needsAdvisorMigration(agent) {
  if (!agent || agent.id !== "advisor") return false;
  return (
    agent.responseMode !== "structured" ||
    !String(agent.greeting || "").includes(ADVISOR_GREETING_MARK) ||
    !String(agent.system || "").toLowerCase().includes("json")
  );
}

/**
 * 将 KV 中过期的 advisor 配置替换为 _seed.js 最新版，写回一次即可
 */
async function migrateAgentsIfNeeded(kv, agents) {
  if (!Array.isArray(agents) || !agents.some(needsAdvisorMigration)) {
    return agents;
  }

  const seedAdvisor = SEED_AGENTS.find((a) => a.id === "advisor");
  if (!seedAdvisor) return agents;

  const next = agents.map((agent) =>
    needsAdvisorMigration(agent) ? { ...seedAdvisor } : agent
  );
  await kv.set(KEY, next);
  return next;
}

// 动态加载 KV(没装/没配时优雅降级)
async function getKV() {
  try {
    if (!process.env.KV_REST_API_URL) return null; // 没配 KV 环境变量
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

// 读取全部 Agent
export async function listAgents() {
  const kv = await getKV();
  if (!kv) return { agents: SEED_AGENTS, editable: false };

  let agents = await kv.get(KEY);
  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    // 数据库为空 → 用种子初始化
    await kv.set(KEY, SEED_AGENTS);
    agents = SEED_AGENTS;
  } else {
    agents = await migrateAgentsIfNeeded(kv, agents);
  }
  return { agents, editable: true };
}

// 按 id 取单个 Agent
export async function getAgent(id) {
  const { agents } = await listAgents();
  return agents.find((a) => a.id === id) || null;
}

// 保存(新增或更新)一个 Agent,并存历史版本
export async function saveAgent(agent) {
  const kv = await getKV();
  if (!kv) throw new Error("未配置数据库，无法编辑（请在 Vercel 配置 KV）");

  const { agents } = await listAgents();
  const idx = agents.findIndex((a) => a.id === agent.id);

  if (idx >= 0) {
    // 更新前,把旧版本存进历史
    await pushVersion(kv, agents[idx]);
    agents[idx] = agent;
  } else {
    agents.push(agent);
  }
  await kv.set(KEY, agents);
  return agent;
}

// 删除一个 Agent
export async function deleteAgent(id) {
  const kv = await getKV();
  if (!kv) throw new Error("未配置数据库，无法删除");
  const { agents } = await listAgents();
  const next = agents.filter((a) => a.id !== id);
  await kv.set(KEY, next);
  return true;
}

// 存历史版本(最多保留 20 个)
async function pushVersion(kv, agent) {
  const vKey = VERSIONS_PREFIX + agent.id;
  let versions = (await kv.get(vKey)) || [];
  versions.unshift({ ...agent, savedAt: Date.now() });
  versions = versions.slice(0, 20);
  await kv.set(vKey, versions);
}

// 读取某个 Agent 的历史版本
export async function listVersions(id) {
  const kv = await getKV();
  if (!kv) return [];
  return (await kv.get(VERSIONS_PREFIX + id)) || [];
}
