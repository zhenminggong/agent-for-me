# Agent 工作台 · One Person, A Team of Agents

> 一个人 + 一组各司其职的 Agent = 一个团队。
> 不只是几个写死的 Agent，而是一个**可扩展、可在线运营**的 Agent 平台。

线上体验：`https://你的域名.vercel.app`（部署后填入）

---

## 为什么做这个

做 AI 落地这些年，我有三个体会，分别对应这个项目的三个设计：

1. **AI 产品不该是"全能助手"，而是一组"专业角色"。** 一个什么都干的 Agent 往往什么都干不精。真正有用的是把任务拆成清晰职能，每个 Agent 只做好一件事，由统一调度层按场景路由。

2. **AI 顾问最稀缺的能力，是敢说"这个别做"。** 市面上的工具都鼓励"什么都用 AI"。但帮客户拦住坏主意，比促成烂项目更有价值。

3. **做出一个 Agent 只是 20% 的工作，剩下 80% 是上线后的持续调优。** 所以我没把 Agent 写死，而是做了一个管理后台——能在线新建、改人设、调参数，**改完立即生效、无需重新部署**，还能存历史版本、一键回滚。这是把"持续迭代"本身做成了能力。

---

## 五个能力

### ① 多 Agent，统一调度
当前内置两个 Agent，但架构是开放的：所有 Agent 是数据库里的配置，新增一个只需在后台填一份配置，不改任何代码、不重新部署。调度逻辑、API、UI 全部复用。

### ② 在线编辑 + 热更新 + 版本回滚（管理后台）
点「管理 Agent」进入后台，可以：
- 新建 Agent（名称、人设 prompt、温度、示例、主题色）
- 编辑已有 Agent，**保存即生效**（因为 prompt 是运行时从数据库实时读取的）
- 每次保存自动存历史版本，可一键回滚

这意味着：不懂代码的业务方也能调 Agent；可以对同一个 Agent 做不同 prompt 版本的 A/B；改坏了能回滚。

### ③ 技能不只是提示词，是能真调的函数
很多"Agent 平台"的技能其实只是往 prompt 里塞一段文字——模型照着演，但不会真去做。这里的技能分两级：

- **可执行工具**：在后台给技能绑定一个函数（如 `calculator`、`get_current_time`），模型就会**真的调用它**、拿到真实结果再回答。聊天界面会显示"正在使用 🧮 算数"的痕迹，调了什么一目了然。
- **行事风格技能**：不绑定函数的技能仍然只注入 prompt，负责影响语气和做事方式。

两者可以共存于同一个 Agent。加新工具只需在 `api/_tools.js` 注册表里加一项，对话逻辑一行都不用改。

> 顺带一个安全细节：计算器的表达式来自模型输出，等同于不可信输入，所以是手写的递归下降求值器，绝不用 `eval`。

### ④ 运营看板：把"上线后持续调优"落到数据上
后台「📊 运营看板」实时呈现：浏览量 PV / 独立访客 UV、对话数、token 消耗、工具调用次数、转交次数，以及**裁决结果分布**（能做且值得 / 能做但不值 / 不建议用 AI）和每日趋势。

指标用 Redis 原子操作累加、HyperLogLog 估算去重 UV，埋点失败绝不阻断对话。有了这块，"AI 产品 80% 的工作在上线之后"才不是一句口号——你能看见裁决官到底劝退了多少、token 烧在哪、哪天流量高。

### ⑤ 两个示范 Agent
- **AI 可行性裁决官**：面向不懂 AI 的业务方，先判断"能不能用 AI 做"，再判断"值不值得做"，敢劝退、给替代方案、全程讲人话。
- **小派 · 家庭陪伴 Agent**：面向 C 端情感陪伴，替忙碌子女陪伴家人。

---

## 技术设计

```
浏览器(React)
  ├─ 聊天界面    → /api/chat   { agentId, messages, clientTime, tzOffset }
  │                 ← SSE 流式：delta(正文) / status(工具) / handoff / done
  └─ 管理后台    → /api/agents (增删改查) + /api/versions (历史)
        │
        ▼
Vercel Serverless Functions
  · API key 存环境变量，前端永远拿不到
  · system prompt 运行时从数据库实时读 → 改完即生效
  · 聊天接口返回的 agent 列表脱敏(不含 system)，只有后台拉完整配置
  · 工具调用循环：模型要调函数 → 服务端执行 → 结果回填 → 继续（最多 4 轮）
  · 公开接口按 IP 限流，防止别人拿域名烧我的模型额度
        │
        ├─ Vercel KV(存 Agent 配置、版本历史、限流计数)
        ├─ 工具注册表(本地函数，无外部依赖)
        └─ 阿里云百炼(通义千问)
```

几个有意的取舍：
- **纯前端 + Serverless，零服务器运维。** 工具型应用没必要搭独立后端。
- **优雅降级。** 没配数据库也能跑——自动降级到内置种子配置（只读），聊天照常，只是不能编辑。配了 KV 才解锁在线编辑。
- **限流 fail-open。** 限流是防滥用的，不该成为对话的单点故障：KV 挂了就放行，而不是让所有人都聊不了。
- **统一调度，配置驱动。** 加 Agent = 加配置，加工具 = 加注册项，都不动对话逻辑。
- **该流式的流式，该等的等。** 陪聊逐字流出；裁决官要出完整 JSON 才能校验打分，就老实等——不为了炫技牺牲正确性。
- **温度按场景分。** 陪伴 Agent 高温度（活泼），裁决官低温度（冷静）。

## 技术栈
React + Vite · react-markdown · Vercel Serverless Functions（SSE 流式）· Vercel KV · 阿里云百炼（通义千问 Function Calling）

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入 DASHSCOPE_API_KEY 等
npx vercel dev               # 需要 /api 时用它；纯前端调 UI 可用 npm run dev
npm test                     # 35 项单测，纯函数，不需要密钥和网络
```

---

## 环境变量与鉴权

复制 `.env.example` 为 `.env.local`（本地）或在 Vercel 项目 Settings 中配置：

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（对话必需） |
| `ADMIN_PASSWORD` | 管理后台口令（未配置时管理写接口返回 503） |
| `KV_REST_API_URL` 等 | 由 Vercel KV 自动注入，用于在线编辑与限流计数 |
| `RATE_LIMIT_PER_MIN` / `RATE_LIMIT_PER_DAY` | 每 IP 限流阈值，默认 10 / 100 |
| `COMPANION_TZ_OFFSET` | Cron 运营时区（相对 UTC 分钟数），默认 480 |

**公开接口**（无需口令）：`GET /api/agents`、`POST /api/chat`

**需鉴权接口**：`GET /api/agents?full=1`、`POST /api/agents`、`DELETE /api/agents`、`GET /api/versions`

请求头任选其一：

- `Authorization: Bearer <ADMIN_PASSWORD>`
- `X-Admin-Password: <ADMIN_PASSWORD>`

浏览器访问 `/#/admin` 或侧栏「管理 Agent」，输入口令后存于 `sessionStorage`，后续请求自动带头。

版本历史每个 Agent 最多保留 **20** 条。

---

作者：龚振明 · AI 产品 / 解决方案
