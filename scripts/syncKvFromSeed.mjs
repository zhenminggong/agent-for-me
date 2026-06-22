/**
 * 将 api/_seed.js 中的 SEED_AGENTS 写入 Vercel KV（agents:list）
 * 用法：node --env-file=.vercel/.env.production.local scripts/syncKvFromSeed.mjs
 */

import { kv } from "@vercel/kv";
import { SEED_AGENTS } from "../api/_seed.js";

const KEY = "agents:list";

async function main() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error("缺少 KV_REST_API_URL 或 KV_REST_API_TOKEN，请先 vercel env pull");
    process.exit(1);
  }

  await kv.set(KEY, SEED_AGENTS);
  const advisor = SEED_AGENTS.find((a) => a.id === "advisor");
  console.log("KV 已更新 agents:list，共", SEED_AGENTS.length, "个 Agent");
  console.log("advisor greeting 前 40 字:", advisor?.greeting?.slice(0, 40));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
