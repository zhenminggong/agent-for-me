import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";
import AdminPanel from "./AdminPanel.jsx";
import FeasibilityVerdict from "./FeasibilityVerdict.jsx";
import AgentDetailPanel from "./AgentDetailPanel.jsx";

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
          clientTime: new Date().toISOString(),
        }),
      });
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
                          {m.content ?? "(空消息)"}
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
    </div>
  );
}
