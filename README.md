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

## 三个能力

### ① 多 Agent，统一调度
当前内置两个 Agent，但架构是开放的：所有 Agent 是数据库里的配置，新增一个只需在后台填一份配置，不改任何代码、不重新部署。调度逻辑、API、UI 全部复用。

### ② 在线编辑 + 热更新 + 版本回滚（管理后台）
点「管理 Agent」进入后台，可以：
- 新建 Agent（名称、人设 prompt、温度、示例、主题色）
- 编辑已有 Agent，**保存即生效**（因为 prompt 是运行时从数据库实时读取的）
- 每次保存自动存历史版本，可一键回滚

这意味着：不懂代码的业务方也能调 Agent；可以对同一个 Agent 做不同 prompt 版本的 A/B；改坏了能回滚。

### ③ 两个示范 Agent
- **AI 可行性裁决官**：面向不懂 AI 的业务方，先判断"能不能用 AI 做"，再判断"值不值得做"，敢劝退、给替代方案、全程讲人话。
- **小派 · 家庭陪伴 Agent**：面向 C 端情感陪伴，替忙碌子女陪伴家人。

---

## 技术设计

```
浏览器(React)
  ├─ 聊天界面    → /api/chat   { agentId, messages }
  └─ 管理后台    → /api/agents (增删改查) + /api/versions (历史)
        │
        ▼
Vercel Serverless Functions
  · API key 存环境变量，前端永远拿不到
  · system prompt 运行时从数据库实时读 → 改完即生效
  · 聊天接口返回的 agent 列表脱敏(不含 system)，只有后台拉完整配置
        │
        ├─ Vercel KV(存 Agent 配置与版本历史)
        └─ 阿里云百炼(通义千问)
```

几个有意的取舍：
- **纯前端 + Serverless，零服务器运维。** 工具型应用没必要搭独立后端。
- **优雅降级。** 没配数据库也能跑——自动降级到内置种子配置（只读），聊天照常，只是不能编辑。配了 KV 才解锁在线编辑。
- **统一调度，配置驱动。** 加 Agent = 加配置，不改架构。
- **温度按场景分。** 陪伴 Agent 高温度（活泼），裁决官低温度（冷静）。

## 技术栈
React + Vite · Vercel Serverless Functions · Vercel KV · 阿里云百炼（通义千问）

---

## 环境变量与鉴权

复制 `.env.example` 为 `.env.local`（本地）或在 Vercel 项目 Settings 中配置：

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（对话必需） |
| `ADMIN_PASSWORD` | 管理后台口令（未配置时管理写接口返回 503） |
| `KV_REST_API_URL` 等 | 由 Vercel KV 自动注入，用于在线编辑 |

**公开接口**（无需口令）：`GET /api/agents`、`POST /api/chat`

**需鉴权接口**：`GET /api/agents?full=1`、`POST /api/agents`、`DELETE /api/agents`、`GET /api/versions`

请求头任选其一：

- `Authorization: Bearer <ADMIN_PASSWORD>`
- `X-Admin-Password: <ADMIN_PASSWORD>`

浏览器访问 `/#/admin` 或侧栏「管理 Agent」，输入口令后存于 `sessionStorage`，后续请求自动带头。

版本历史每个 Agent 最多保留 **20** 条。

---

作者：龚振明 · AI 产品 / 解决方案
