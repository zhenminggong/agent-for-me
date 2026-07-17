import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";
import AdminPanel from "./AdminPanel.jsx";
import FeasibilityVerdict from "./FeasibilityVerdict.jsx";
import AgentDetailPanel from "./AgentDetailPanel.jsx";
import MessageContent from "./MessageContent.jsx";
import MetricsDashboard from "./MetricsDashboard.jsx";

const ADMIN_HASH = "#/admin";

function isAdminHash() {
  const h = window.location.hash;
  return h === ADMIN_HASH || h.startsWith("#/admin");
}

/** 解析 #/admin?agent=xxx&section=skills 等查询参数 */
function parseAdminHashQuery() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  if (qIndex < 0) return { agentId: null, section: null };
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return {
    agentId: params.get("agent") || null,
    section: params.get("section") || null,
  };
}

/**
 * 当前本地「墙上时钟」，形如 2026-07-16T21:30。
 * 不用 toISOString()——那是 UTC，服务端（Vercel 跑在 UTC）会把它当本地时间读，
 * 东八区用户的时间感知会整体偏 8 小时。
 */
function localClientTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 本地时区相对 UTC 的分钟数，东八区为 +480 */
function localTzOffset() {
  return -new Date().getTimezoneOffset();
}

/** 取（或生成）匿名访客 id，存 localStorage，用于 UV 去重；不含任何个人信息 */
function getVisitorId() {
  const KEY = "agentteam:visitorId";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null; // 隐私模式禁用了 storage：照常上报，只是 UV 会略偏高
  }
}

/** 上报一次页面浏览。失败静默——统计不该影响用户体验 */
function reportPageView() {
  try {
    fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: getVisitorId(), tzOffset: localTzOffset() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** 响应是否为 SSE 流（非结构化 Agent 走流式，advisor 仍走 JSON） */
function isEventStream(resp) {
  return (resp.headers.get("content-type") || "").includes("text/event-stream");
}

/**
 * 逐段读取 SSE 流。事件形如 `data: {"type":"delta","text":"..."}`。
 * @param {Response} resp
 * @param {{ onDelta: (t:string)=>void, onHandoff: (h:object)=>void, onError: (e:string)=>void, onStatus: (s:object)=>void }} handlers
 */
async function readEventStream(resp, { onDelta, onHandoff, onError, onStatus }) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 末段可能是半截事件，留到下一轮
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(trimmed.slice(5).trim());
        if (evt.type === "delta") onDelta(evt.text);
        else if (evt.type === "status") onStatus(evt);
        else if (evt.type === "handoff") onHandoff(evt.handoff);
        else if (evt.type === "error") onError(evt.error);
      } catch {
        /* 半截 JSON，跳过 */
      }
    }
  }
}

/** 解析 /api/chat 响应，兼容 JSON 错误体与 HTML 404（仅 npm run dev 时常见） */
async function readChatResponse(resp) {
  const raw = await resp.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      /* 非 JSON，例如 Vite 返回的 HTML */
    }
  }

  if (!resp.ok) {
    const errMsg =
      data?.error ||
      (raw?.trimStart().startsWith("<")
        ? "接口不可用（请用 vercel dev 启动，不要只用 npm run dev）"
        : raw?.slice(0, 200)) ||
      `HTTP ${resp.status}`;
    return { content: `出错了：${errMsg}`, isError: true };
  }

  const reply =
    (typeof data?.reply === "string" && data.reply) ||
    (typeof data?.content === "string" && data.content) ||
    "";
  const structured =
    data?.structured && typeof data.structured === "object"
      ? data.structured
      : null;
  const handoff =
    data?.handoff && typeof data.handoff === "object" && data.handoff.targetId
      ? {
          targetId: data.handoff.targetId,
          reason: data.handoff.reason || "",
          label: data.handoff.label || data.handoff.targetId,
        }
      : null;

  return {
    content: reply.trim() || "(无回复内容，请重试)",
    structured,
    handoff,
    isError: false,
  };
}

export default function App() {
  const [agents, setAgents] = useState([]);
  const [editable, setEditable] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [histories, setHistories] = useState({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [adminFocus, setAdminFocus] = useState({ agentId: null, section: null });
  const [booting, setBooting] = useState(true);
  const [showDetail, setShowDetail] = useState(true);
  const [pendingHandoff, setPendingHandoff] = useState(null);
  const endRef = useRef(null);
  /** 递增后使进行中的 send 忽略结果，避免清空后旧回复写回 */
  const chatEpochRef = useRef(0);

  // 加载 Agent 列表
  const loadAgents = useCallback(async () => {
    try {
      const resp = await fetch("/api/agents");
      const data = await resp.json();
      const list = data.agents || [];
      setAgents(list);
      setEditable(!!data.editable);
      setActiveId((cur) => cur || list[0]?.id || null);
      // 为新出现的 agent 初始化对话历史(带开场白)
      setHistories((h) => {
        const next = { ...h };
        list.forEach((a) => {
          if (!next[a.id]) {
            next[a.id] = [{ role: "assistant", content: a.greeting }];
          }
        });
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // 每次载入上报一次浏览量（PV），按匿名 visitorId 去重成 UV
  useEffect(() => { reportPageView(); }, []);

  // Hash 路由：#/admin 打开管理面板，并解析 ?agent= & section=
  useEffect(() => {
    const syncAdminFromHash = () => {
      setShowAdmin(isAdminHash());
      setAdminFocus(parseAdminHashQuery());
    };
    syncAdminFromHash();
    window.addEventListener("hashchange", syncAdminFromHash);
    return () => window.removeEventListener("hashchange", syncAdminFromHash);
  }, []);

  const openAdmin = (agentId = null, section = null) => {
    const params = new URLSearchParams();
    if (agentId) params.set("agent", agentId);
    if (section) params.set("section", section);
    const query = params.toString();
    window.location.hash = query ? `/admin?${query}` : "/admin";
    setShowAdmin(true);
  };

  const openAdminForSkills = (agentId) => openAdmin(agentId, "skills");

  const closeAdmin = () => {
    if (isAdminHash()) {
      const base = window.location.pathname + window.location.search;
      history.replaceState(null, "", base);
    }
    setShowAdmin(false);
  };

  const agent = agents.find((a) => a.id === activeId);
  const messages = (agent && histories[activeId]) || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  /** 接受 handoff：切换 Agent 并注入转交上下文 */
  const acceptHandoff = (handoff, fromAgentId) => {
    if (!handoff?.targetId) return;
    const target = agents.find((a) => a.id === handoff.targetId);
    if (!target) return;

    const fromName = agents.find((a) => a.id === fromAgentId)?.name || "上一 Agent";
    const reasonLine = handoff.reason
      ? `转交原因：${handoff.reason}`
      : "已按协作编排切换 Agent。";
    const contextNote = `[系统] 由「${fromName}」转交至此。${reasonLine}`;

    setHistories((h) => {
      const existing = h[handoff.targetId] || [{ role: "assistant", content: target.greeting }];
      const hasOnlyGreeting = existing.length === 1 && existing[0].role === "assistant";
      const base = hasOnlyGreeting ? existing : existing;
      return {
        ...h,
        [handoff.targetId]: [...base, { role: "assistant", content: contextNote, isHandoffNote: true }],
      };
    });

    setActiveId(handoff.targetId);
    setPendingHandoff(null);
  };

  const dismissHandoff = () => setPendingHandoff(null);

  const clearContext = () => {
    if (!agent || !activeId) return;
    const ok = window.confirm(
      "清空当前 Agent 的对话？将回到开场白，进行中的回复会被取消。"
    );
    if (!ok) return;

    chatEpochRef.current += 1;
    setLoading(false);
    setInput("");
    setHistories((h) => ({
      ...h,
      [activeId]: [{ role: "assistant", content: agent.greeting }],
    }));
  };

  /**
   * 消费 SSE 流：首个增量到达即撤掉打字动画，之后原地累加渲染。
   * 期间若用户清空了上下文（epoch 变化），丢弃后续增量。
   */
  const consumeStream = async (resp, { agentIdForRequest, epochAtStart, updated }) => {
    let acc = "";
    let handoff = null;
    let streamError = null;
    let firstDelta = true;
    const toolTrace = []; // 本轮实际调用过的工具，随消息一起留档

    const paint = (streaming) => {
      if (epochAtStart !== chatEpochRef.current) return;
      setHistories((h) => ({
        ...h,
        [agentIdForRequest]: [
          ...updated,
          {
            role: "assistant",
            content: acc,
            streaming,
            isError: !!streamError,
            tools: toolTrace.length ? [...toolTrace] : undefined,
          },
        ],
      }));
    };

    await readEventStream(resp, {
      onDelta: (t) => {
        acc += t;
        if (firstDelta) {
          firstDelta = false;
          if (epochAtStart === chatEpochRef.current) setLoading(false);
        }
        paint(true);
      },
      onStatus: (s) => {
        // 工具调用期间模型不产出正文，用这个撑住等待感
        toolTrace.push({ tool: s.tool, label: s.label, icon: s.icon });
        if (epochAtStart === chatEpochRef.current) setLoading(false);
        paint(true);
      },
      onHandoff: (h) => { handoff = h; },
      onError: (e) => { streamError = e; acc = acc || `出错了：${e}`; },
    });

    if (epochAtStart !== chatEpochRef.current) return;
    paint(false);
    if (handoff && !streamError) {
      setPendingHandoff({ ...handoff, fromAgentId: agentIdForRequest });
    }
  };

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || loading || !agent) return;

    const agentIdForRequest = activeId;
    const epochAtStart = chatEpochRef.current;
    const updated = [...messages, { role: "user", content }];
    setHistories((h) => ({ ...h, [agentIdForRequest]: updated }));
    setInput("");
    setLoading(true);

    try {
      const apiMessages = updated
        .filter((m, i) => !(i === 0 && m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content }));

      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agentIdForRequest,
          messages: apiMessages,
          clientTime: localClientTime(),
          tzOffset: localTzOffset(),
        }),
      });
      if (isEventStream(resp)) {
        await consumeStream(resp, { agentIdForRequest, epochAtStart, updated });
        return;
      }

      const { content: reply, structured, handoff, isError } = await readChatResponse(resp);
      if (epochAtStart !== chatEpochRef.current) return;
      setHistories((h) => ({
        ...h,
        [agentIdForRequest]: [
          ...updated,
          { role: "assistant", content: reply, structured, isError },
        ],
      }));
      if (handoff && !isError) {
        setPendingHandoff({ ...handoff, fromAgentId: agentIdForRequest });
      }
    } catch (err) {
      if (epochAtStart !== chatEpochRef.current) return;
      setHistories((h) => ({
        ...h,
        [agentIdForRequest]: [
          ...updated,
          {
            role: "assistant",
            content: `网络出错：${err?.message || "请求失败，请检查 Network 面板"}`,
            isError: true,
          },
        ],
      }));
    } finally {
      if (epochAtStart === chatEpochRef.current) setLoading(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  if (booting) {
    return <div className="boot">加载 Agent 配置中…</div>;
  }

  return (
    <div className="app" style={{ "--accent": agent?.accent || "#4a8fb8" }}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">⌘</div>
          <div>
            <div className="brand-title">Agent 工作台</div>
            <div className="brand-sub">One person · A team of agents</div>
          </div>
        </div>

        <nav className="agent-nav">
          {agents.map((a) => (
            <button
              key={a.id}
              className={`agent-tab ${activeId === a.id ? "active" : ""}`}
              onClick={() => setActiveId(a.id)}
              style={{ "--tab-accent": a.accent }}
            >
              <span className="agent-dot" />
              <span className="agent-tab-text">
                <span className="agent-tab-name">{a.icon} {a.name}</span>
                <span className="agent-tab-tag">{a.tagline}</span>
                {a.skills?.length > 0 && (
                  <span className="agent-tab-skills">{a.skills.length} 项技能</span>
                )}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="dashboard-btn" onClick={() => setShowDashboard(true)}>
            📊 运营看板
          </button>
          <button className="admin-btn" onClick={openAdmin}>
            ⚙ 管理 Agent
          </button>
          <p className="foot-note">
            {editable
              ? "配置存于数据库，可在线编辑、热更新、回滚。"
              : "当前为只读模式（未配置数据库）。"}
          </p>
        </div>
      </aside>

      <main className="main">
        {agent && (
          <>
            <header className="main-head">
              <div className="main-head-row">
                <div>
                  <h1>{agent.icon} {agent.name}</h1>
                  <p>{agent.desc}</p>
                  {agent.skills?.length > 0 && (
                    <div className="head-skill-tags">
                      {agent.skills.slice(0, 4).map((s) => (
                        <span key={s.id} className="head-skill-tag">
                          {s.icon} {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="main-head-actions">
                  <button
                    type="button"
                    className={`detail-toggle-btn${showDetail ? " active" : ""}`}
                    onClick={() => setShowDetail((v) => !v)}
                    title={showDetail ? "隐藏能力面板" : "显示能力面板"}
                  >
                    {showDetail ? "隐藏面板" : "能力面板"}
                  </button>
                  <button
                    type="button"
                    className="clear-context-btn"
                    onClick={clearContext}
                    title="清空当前 Agent 对话，开始新场景"
                  >
                    清空上下文
                  </button>
                </div>
              </div>
            </header>

            <div className={`main-body${showDetail ? " with-detail" : ""}`}>
              {showDetail && (
                <AgentDetailPanel
                  agent={agent}
                  agents={agents}
                  onSwitchAgent={setActiveId}
                  onConfigureSkills={openAdminForSkills}
                />
              )}

              <div className="chat-area">
                {pendingHandoff && (
                  <div className="handoff-banner">
                    <div className="handoff-banner-text">
                      <span className="handoff-banner-icon">🔗</span>
                      建议转交
                      <strong>
                        {agents.find((a) => a.id === pendingHandoff.targetId)?.icon}{" "}
                        {pendingHandoff.label ||
                          agents.find((a) => a.id === pendingHandoff.targetId)?.name}
                      </strong>
                      {pendingHandoff.reason && (
                        <span className="handoff-banner-reason">：{pendingHandoff.reason}</span>
                      )}
                    </div>
                    <div className="handoff-banner-actions">
                      <button
                        type="button"
                        className="handoff-accept-btn"
                        onClick={() => acceptHandoff(pendingHandoff, pendingHandoff.fromAgentId)}
                      >
                        切换 Agent
                      </button>
                      <button
                        type="button"
                        className="handoff-dismiss-btn"
                        onClick={dismissHandoff}
                      >
                        暂不
                      </button>
                    </div>
                  </div>
                )}
                <div className="chat">
                  {messages.map((m, i) => (
                    <div key={i} className={`row ${m.role}`}>
                      {m.role === "assistant" && <div className="avatar">{agent.icon}</div>}
                      {m.role === "assistant" &&
                      activeId === "advisor" &&
                      m.structured &&
                      !m.isError ? (
                        <FeasibilityVerdict
                          report={m.structured}
                          fallbackText={m.content}
                        />
                      ) : (
                        <div
                          className={`bubble${m.isError ? " error" : ""}${m.isHandoffNote ? " handoff-note" : ""}`}
                        >
                          {m.tools?.length > 0 && (
                            <div className="tool-trace">
                              {m.tools.map((t, ti) => (
                                <span key={ti} className="tool-chip">
                                  <span className="tool-chip-icon">{t.icon}</span>
                                  {t.label}
                                  {m.streaming && ti === m.tools.length - 1 && !m.content && (
                                    <span className="tool-chip-dots">
                                      <span></span><span></span><span></span>
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.role === "assistant" && !m.isError && !m.isHandoffNote ? (
                            <MessageContent
                              text={m.content ?? ""}
                              streaming={m.streaming}
                            />
                          ) : (
                            m.content ?? "(空消息)"
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {loading && (
                    <div className="row assistant">
                      <div className="avatar">{agent.icon}</div>
                      <div className="bubble typing"><span></span><span></span><span></span></div>
                    </div>
                  )}
                  <div ref={endRef} />
                </div>

                {messages.length <= 1 && agent.samples?.length > 0 && (
                  <div className="samples">
                    {agent.samples.map((s, i) => (
                      <button key={i} className="sample" onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                )}

                <div className="composer">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKey}
                    placeholder={agent.placeholder}
                    rows={1}
                    disabled={loading}
                  />
                  <button className="send" onClick={() => send()} disabled={loading || !input.trim()}>
                    发送
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {showAdmin && (
        <AdminPanel
          editable={editable}
          onClose={closeAdmin}
          onChanged={loadAgents}
          focusAgentId={adminFocus.agentId}
          focusSection={adminFocus.section}
        />
      )}

      {showDashboard && (
        <div className="admin-overlay" onClick={() => setShowDashboard(false)}>
          <div className="admin dashboard-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-head">
              <h2>📊 运营看板</h2>
              <button className="x" onClick={() => setShowDashboard(false)}>✕</button>
            </div>
            <div className="dashboard-modal-body">
              <MetricsDashboard />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
