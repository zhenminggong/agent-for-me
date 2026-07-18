# Agent 工作台 · 项目交接文档

> 线上地址：https://agent.gufanai.com  
> GitHub：`git@github.com:zhenminggong/agent-for-me.git`（私有）  
> Vercel 项目名：`agent-team-v2`  
> 交接日期：2026-07-16  
> 当前代码主分支：`main`

本文档面向接手人：说明项目是什么、怎么跑、怎么部署、关键配置在哪、已知限制和下一步建议。

---

## 1. 一句话定位

**配置驱动的多 Agent 对话与运营平台**：前端聊天 + 管理后台；Agent 人设/技能/协作规则存在 KV，改完热更新；核心示范 Agent 是「AI 可行性裁决官」（结构化评分）和「小派」（陪伴 + 日程感知）。

**不是** LangChain / Dify / Coze 项目；**是** React + Vercel Serverless + 直连通义千问 API 的自研轻量平台。

---

## 2. 能力真相表（避免交接误解）

| 能力 | 状态 | 说明 |
|------|------|------|
| 多 Agent | ✅ | 配置驱动，当前 2 个；后台可增删 |
| Skills | ✅ 两级 | 绑定 `tool` 的技能是**可执行工具**（模型真调用）；未绑定的仍为 prompt 级影响风格 |
| Function Calling / 工具调用 | ✅ | 原生 `tools`；注册表见 `api/_tools.js`，当前 3 个：计算器 / 当前时间 / 工作台自省 |
| 流式输出 | ✅ | 非结构化 Agent 走 SSE 逐字下发；工具调用轮下发 `status` 事件 |
| Markdown 渲染 | ✅ | react-markdown + GFM（表格/删除线）；裸 HTML 默认转义 |
| Handoff 协作 | ⚠️ 轻量编排 | LLM 建议转交 → 前端横幅确认 → 切换 Agent；非 DAG 工作流，**不携带上下文摘要** |
| 结构化输出 | ✅ | advisor 用 `json_object` + 自研解析/校验/重试（非流式） |
| 陪伴日程 | ⚠️ MVP | 对话时注入时间感知（时区正确）；Cron 每日一次仅打快照日志 |
| 限流 | ✅ | `/api/chat` 按 IP 分钟窗+日窗（需 KV；无 KV 或 KV 故障时放行） |
| 运营看板 | ✅ | 后台「📊 运营看板」：PV/UV、对话数、token、工具调用、handoff、裁决分布 + 每日趋势（需 KV） |
| 语音输入 | ✅ | 输入框🎤按钮：录音→转 16kHz WAV→`/api/asr` 调 qwen3-asr-flash 识别→填入。复用 DASHSCOPE_API_KEY。微信 WebView/无麦克风环境自动隐藏按钮 |
| 会话持久化 | ❌ | 仅存 React state，刷新即丢 |
| RAG / 知识库 | ❌ | 无 |

---

## 3. 仓库与目录结构

```
agent-team-v2/
├── api/                          # Vercel Serverless
│   ├── chat.js                   # 对话入口（SSE 流式 + 工具调用循环 + handoff）
│   ├── agents.js                 # Agent CRUD（GET 附带工具注册表清单）
│   ├── versions.js               # 版本历史
│   ├── _seed.js                  # 种子配置（无 KV 时兜底）
│   ├── _store.js                 # KV 读写 + 迁移
│   ├── _runtime.js               # skills / handoff / schedule 拼装；时区换算；流式标记扣留
│   ├── _tools.js                 # ★ 可执行工具注册表（加工具只改这里）
│   ├── _ratelimit.js             # ★ 公开接口 IP 限流
│   ├── _metrics.js               # ★ 运营指标收集（PV/UV/对话/token/裁决…）
│   ├── metrics.js                # ★ 指标 API：POST 上报浏览 / GET 看板（鉴权）
│   ├── _feasibility.js           # 裁决 JSON 解析校验
│   ├── _auth.js                  # 管理口令鉴权
│   └── cron/companion-reminder.js
├── src/                          # React 前端
│   ├── App.jsx                   # 主工作台 + SSE 消费 + handoff UI
│   ├── MessageContent.jsx        # ★ Markdown 渲染 + 流式光标
│   ├── MetricsDashboard.jsx      # ★ 运营看板（数字卡片 + 趋势图 + 裁决分布）
│   ├── AgentDetailPanel.jsx      # 技能/编排/日程侧栏（标注真工具）
│   ├── AdminPanel.jsx            # 管理后台（技能可绑定工具）
│   ├── FeasibilityVerdict.jsx    # 裁决卡片
│   └── ...
├── test/                         # ★ node:test，无需密钥，npm test
├── scripts/syncKvFromSeed.mjs    # 本地把 seed 写入 KV（需凭证）
├── vercel.json                   # Cron 每天 UTC 09:00；chat 函数 maxDuration 60s
├── .env.example                  # 环境变量模板
├── README.md                     # 产品说明
└── HANDOVER.md                   # 本交接文档
```

**打包时请排除**：`node_modules/`、`dist/`、`.vercel/`、`.env*`（保留 `.env.example`）、`_tmp_*`、`_vercel_*`、`_deploy_*` 等临时文件。

---

## 4. 本地开发

### 4.1 依赖

- Node.js 18+（生产曾用 24.x）
- npm / pnpm 均可

```bash
npm install
cp .env.example .env.local   # 填入下方变量
npm run dev                  # Vite 开发前端
```

本地调 Serverless API 推荐：

```bash
npx vercel dev
```

（需已 `vercel link` 到项目；国内网络可能需要代理 `HTTPS_PROXY=http://127.0.0.1:7890`）

### 4.2 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DASHSCOPE_API_KEY` | ✅ | 阿里云百炼 API Key，对话必需 |
| `ADMIN_PASSWORD` | ✅（管理写） | 管理后台口令；未配则写接口 503 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 推荐 | Vercel KV；无则降级 seed 只读，且限流失效 |
| `CRON_SECRET` | 推荐 | 保护 `/api/cron/companion-reminder` |
| `RATE_LIMIT_PER_MIN` | 可选 | 每 IP 每分钟上限，默认 10 |
| `RATE_LIMIT_PER_DAY` | 可选 | 每 IP 每日上限，默认 100 |
| `COMPANION_TZ_OFFSET` | 可选 | Cron 运营时区（相对 UTC 分钟数），默认 480（东八区） |
| `KV_URL` / `REDIS_URL` 等 | 可选 | KV 集成自动注入 |

**公开接口**：`GET /api/agents`、`POST /api/chat`  
**需鉴权**：`GET /api/agents?full=1`、`POST/DELETE /api/agents`、`GET /api/versions`  
鉴权头：`Authorization: Bearer <ADMIN_PASSWORD>` 或 `X-Admin-Password: <ADMIN_PASSWORD>`

管理后台入口：`/#/admin` 或侧栏「管理 Agent」；技能快捷入口：侧栏「⚙ 配置」→ `#/admin?agent=<id>&section=skills`

---

## 5. 部署与运维

### 5.1 常规路径

1. 推送 `main` → GitHub `zhenminggong/agent-for-me`
2. Vercel Git 集成自动构建 Production
3. 自定义域名：`agent.gufanai.com`

### 5.2 曾踩过的坑（务必知晓）

1. **Hobby 计划 Cron 限制**  
   不可用 `0 * * * *`（每小时）。必须每天最多 1 次。当前为 `0 9 * * *`（UTC 09:00）。若改回每小时，**Git 部署会被 Vercel 拒绝**，Production 会卡在旧 commit。

2. **KV 里可能是旧 Advisor 配置**  
   `_store.js` 有自动迁移：缺 skills / 旧 greeting / 无 structured 时从 seed 补齐。若开场白仍是旧文案，检查 KV 或触发一次 `GET /api/agents`。

3. **DashScope JSON Mode**  
   `response_format: json_object` 要求 messages 里出现 `json` 字样；`ensureJsonHintInMessages()` 已兜底。

4. **CLI `vercel env pull` / API token**  
   本地曾出现 TLS 失败、token 403；生产环境变量以 Vercel Dashboard 为准。

5. **Git 作者邮箱无 Team 权限**  
   历史上若 commit author 不在 Vercel Team，部署可能 BLOCKED。用已授权 GitHub 账号推送即可。

6. **时区：服务端永远是 UTC**  
   Vercel 函数跑在 UTC，任何 `new Date().getHours()` 都是 UTC 时刻。凡涉及「用户几点」
   必须走 `clientTime`（墙上时钟）或 `wallClockFromEpoch(epoch, tzOffset)`，别再用本地时区取值器。
   Cron 无客户端可问，用 `COMPANION_TZ_OFFSET`。

7. **流式与 handoff 标记**  
   `[HANDOFF:id:reason]` 是逐字流过来的，`splitStreamSafe()` 负责扣住可能构成标记的尾巴。
   改 handoff 标记格式时**务必同步改它**，否则标记会一个字一个字蹦给用户看。

8. **DashScope 流式 tool_calls 尚未经真实密钥验证**  
   工具调用循环按 OpenAI 兼容规范实现，已用假模型完整验证（含参数分片重组）；
   但**未用真 `DASHSCOPE_API_KEY` 打过线上**。首次部署后请先跑 §10 的工具冒烟检查。

### 5.3 手动部署（Git 未触发时）

```bash
# 需代理时可先设 HTTPS_PROXY
npx vercel deploy --prod --yes
```

### 5.4 同步 seed → 生产 KV（可选）

```bash
# 先 vercel env pull 拿到 KV 凭证
node --env-file=.vercel/.env.production.local scripts/syncKvFromSeed.mjs
```

或走管理后台 `#/admin` 手动保存各 Agent。

---

## 6. 核心数据模型（Agent 配置）

每个 Agent 大致字段：

```js
{
  id, name, tagline, desc, placeholder, accent, icon,
  temperature, greeting, samples, system,   // 对话核心
  responseMode,                              // "structured" → 裁决 JSON
  skills: [{ id, name, desc, icon }],       // 注入 prompt
  agentLinks: [{ targetId, label, trigger }], // handoff 规则
  schedule: {                                // 陪伴日程（可选）
    rhythm, dailyReminders: [{ time, label }], careTopics: []
  }
}
```

- KV key：`agents:list`  
- 版本历史：`agent:versions:<id>`（最多 20 条）  
- 前端公开列表会去掉 `system`（`toPublic`）

---

## 7. 请求与响应约定

### `POST /api/chat`

请求：

```json
{
  "agentId": "advisor",
  "messages": [{ "role": "user", "content": "..." }],
  "clientTime": "2026-07-16T21:30",
  "tzOffset": 480
}
```

- `clientTime`：**用户本地墙上时钟**（`YYYY-MM-DDTHH:mm`），不要传 `toISOString()` 的 UTC 值  
- `tzOffset`：相对 UTC 的分钟数，东八区 `+480`（前端用 `-new Date().getTimezoneOffset()`）

**响应有两种，按 `Content-Type` 区分**：

**① 非结构化 Agent → `text/event-stream`（SSE）**

```
data: {"type":"delta","text":"逐"}
data: {"type":"status","tool":"calculator","label":"算数","icon":"🧮"}
data: {"type":"handoff","handoff":{"targetId":"advisor","reason":"...","label":"..."}}
data: {"type":"done"}
data: {"type":"error","error":"..."}          // 流已开始后才出错，只能走流内报错
```

- `delta`：正文增量。`[HANDOFF:...]` 标记在服务端扣留剥离，**绝不会出现在 delta 里**
- `status`：正在调用某工具，前端渲染为 chip

**② advisor / `responseMode: structured` → `application/json`**

```json
{
  "reply": "文本摘要",
  "structured": { "...裁决报告..." },
  "handoff": { "targetId": "companion", "reason": "...", "label": "..." }
}
```

结构化输出需要完整 JSON 才能解析校验，故不走流式。

### `/api/metrics`

- `POST { visitorId, tzOffset }`：公开，上报一次页面浏览（PV +1，UV 按 visitorId 去重）。前端每次载入自动调。
- `GET ?days=14`：**需管理鉴权**（同 admin 口令）。返回 `{ available, total, daily[], firstDay }`；未配 KV 时 `{ available: false }`。

指标存 KV（`metrics:*`），用 `hincrby` 原子累加、HyperLogLog 算 UV。埋点全程 fail-silent，写入失败不影响对话与响应。

### `/api/asr`（语音识别）

- `POST { audio, language? }`：`audio` 为 `data:audio/wav;base64,...`（或 mpeg）。调百炼 `qwen3-asr-flash` 同步识别，返回 `{ text, seconds }`。复用 `DASHSCOPE_API_KEY`、同 IP 限流。上限约 10MB。
- 前端 `src/voiceInput.js` 负责录音（MediaRecorder）→ 解码重采样为 16kHz 单声道 WAV（qwen3-asr-flash 只吃 wav/mpeg，而浏览器录的是 webm/opus）→ base64。
- ⚠️ **本地无法自动验证**：录音需真实浏览器 + 麦克风 + HTTPS。后端 API 已用真 key 冒烟通过、handler 有单测；录音链路须线上真机测。微信内置浏览器不支持录音，按钮会自动隐藏。

---

## 8. 两个示范 Agent

| id | 名称 | 特点 |
|----|------|------|
| `advisor` | AI 可行性裁决官 | 低温度、结构化 6 维评分、双闸门裁决、可 handoff 到小派 |
| `companion` | 小派 | 高温度、陪伴人设、日程注入、可 handoff 到裁决官 |

---

## 9. 账号与外部服务清单（接手人需自行确认权限）

| 服务 | 用途 | 备注 |
|------|------|------|
| GitHub `zhenminggong/agent-for-me` | 源码 | 私有仓，需协作者权限 |
| Vercel 团队 `zhenmings-projects-4edfac83` | 部署 + KV + 域名 | 项目 `agent-team-v2` |
| 阿里云百炼 DashScope | LLM | 环境变量 `DASHSCOPE_API_KEY` |
| 域名 `agent.gufanai.com` | 生产入口 | 在 Vercel Domains 绑定 |

**密钥不要写进仓库或交接 zip。** 交接时当面/安全渠道移交：DashScope Key、Admin 口令、Vercel/GitHub 权限。

---

## 10. 常用验证清单

- [ ] `npm test` 全绿（43 项，纯函数，不需要密钥/网络）  
- [ ] 打开 https://agent.gufanai.com ，能加载两个 Agent  
- [ ] 裁决官：输入业务场景 → 出现结构化裁决卡片（分数有差异、reason 非空）  
- [ ] 小派：回复**逐字流出**（不是等完再一次性出），Markdown 列表/加粗正常渲染  
- [ ] **工具冒烟**：问小派「现在几点？」→ 出现 🕐 看时间 chip，且报的时间与你手表一致（重点验时区）  
- [ ] **工具冒烟**：问小派「帮我算 (1200*12-3000)/8」→ 出现 🧮 算数 chip，答案为 1425  
- [ ] **工具冒烟**：问小派「这个工作台有哪些 Agent？」→ 出现 🗂 chip 且列举正确  
- [ ] 小派：接近提醒时段时更易主动关心对应话题  
- [ ] 侧栏：技能区显示「N 项 · M 个真工具」，真工具卡片带 🔧 函数名标签  
- [ ] `#/admin`：登录后改 greeting → 刷新聊天可见新开场白  
- [ ] `#/admin`：技能行有工具下拉，选中后保存 → 侧栏该技能出现 🔧 标签  
- [ ] 触发 handoff 场景 → 出现转交横幅并可切换；**正文里不该出现 `[HANDOFF:` 字样**  
- [ ] 限流：连发 >10 条 → 返回 429（需已配 KV）  
- [ ] `#/admin` →「📊 运营看板」：能看到 PV/UV、对话数、token 等卡片与趋势图（需已配 KV；数据随使用累积）  
- [ ] 冒烟几轮对话后回看板：对话数 / token 数字有增长，说明埋点生效  
- [ ] Vercel Deployments：最新 Production Ready，且 `vercel.json` cron 为每日一次  

---

## 11. 建议后续迭代（可选）

按简历/产品优先级：

1. **会话持久化**：现在刷新即丢。先落 localStorage，再进阶到 KV 多会话列表  
2. **RAG**（文档上传 + 检索），给 Agent 挂知识库  
3. **Handoff 携带上下文摘要**：现在转交只注入一行系统提示，目标 Agent 不知道之前聊了什么  
4. **advisor 改用 tool schema 强制结构化**：可替掉 `json_object` + 两轮质量重试，更可靠且省一次调用  
5. 更多工具（联网搜索、天气、日历）—— 加进 `api/_tools.js` 即可，无需改 chat.js  
6. Cron 结果写入 KV + 用户侧待办问候（更高频需升级 Pro 或外置调度）  
7. **运营看板增强**（已有基础版）：分 Agent 拆解、留存曲线、导出 CSV  

---

## 12. 交接包内容说明

本仓库打出的 zip（见同目录或交付物说明）应包含：

- 全部业务源码（`api/`、`src/`、配置文件）  
- `README.md`、`HANDOVER.md`、`.env.example`  
- **不包含**：`node_modules`、密钥、`.vercel` 本地登录态、临时调试 JSON  

解压后执行 `npm install` → 配置 `.env.local` → `npm run dev` / `vercel dev` 即可本地跑。

---

## 13. 联系与归属

作者 / 原维护：龚振明 · AI 产品 / 解决方案  

有问题优先查：本文件 §5 踩坑、§2 能力真相表、Vercel 最新部署日志。
