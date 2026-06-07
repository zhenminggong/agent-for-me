import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";
import AdminPanel from "./AdminPanel.jsx";

const ADMIN_HASH = "#/admin";

function isAdminHash() {
  const h = window.location.hash;
  return h === ADMIN_HASH || h.startsWith("#/admin");
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
  return {
    content: reply.trim() || "(无回复内容，请重试)",
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
  const [booting, setBooting] = useState(true);
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

  // Hash 路由：#/admin 打开管理面板
  useEffect(() => {
    const syncAdminFromHash = () => setShowAdmin(isAdminHash());
    syncAdminFromHash();
    window.addEventListener("hashchange", syncAdminFromHash);
    return () => window.removeEventListener("hashchange", syncAdminFromHash);
  }, []);

  const openAdmin = () => {
    if (!isAdminHash()) window.location.hash = "/admin";
    setShowAdmin(true);
  };

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
        body: JSON.stringify({ agentId: agentIdForRequest, messages: apiMessages }),
      });
      const { content: reply, isError } = await readChatResponse(resp);
      if (epochAtStart !== chatEpochRef.current) return;
      setHistories((h) => ({
        ...h,
        [agentIdForRequest]: [
          ...updated,
          { role: "assistant", content: reply, isError },
        ],
      }));
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
                  <h1>{agent.name}</h1>
                  <p>{agent.desc}</p>
                </div>
                <button
                  type="button"
                  className="clear-context-btn"
                  onClick={clearContext}
                  title="清空当前 Agent 对话，开始新场景"
                >
                  清空上下文
                </button>
              </div>
            </header>

            <div className="chat">
              {messages.map((m, i) => (
                <div key={i} className={`row ${m.role}`}>
                  {m.role === "assistant" && <div className="avatar">{agent.icon}</div>}
                  <div className={`bubble${m.isError ? " error" : ""}`}>
                    {m.content ?? "(空消息)"}
                  </div>
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
          </>
        )}
      </main>

      {showAdmin && (
        <AdminPanel
          editable={editable}
          onClose={closeAdmin}
          onChanged={loadAgents}
        />
      )}
    </div>
  );
}
