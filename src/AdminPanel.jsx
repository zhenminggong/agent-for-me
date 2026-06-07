import { useState, useEffect } from "react";
import {
  getStoredAdminPassword,
  setStoredAdminPassword,
  clearStoredAdminPassword,
  adminFetch,
} from "./adminAuth.js";

const EMPTY = {
  id: "", name: "", tagline: "", desc: "",
  placeholder: "说点什么……", accent: "#E8915B", icon: "✦",
  temperature: 0.6, greeting: "你好，有什么可以帮你的？",
  samples: [], system: "",
};

export default function AdminPanel({ editable, onClose, onChanged }) {
  const [authed, setAuthed] = useState(!!getStoredAdminPassword());
  const [loginPwd, setLoginPwd] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState("");

  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadFull = async () => {
    const resp = await adminFetch("/api/agents?full=1");
    if (resp.status === 401) {
      clearStoredAdminPassword();
      setAuthed(false);
      setLoginErr("口令错误或已失效，请重新输入");
      return;
    }
    if (resp.status === 503) {
      const data = await resp.json().catch(() => ({}));
      setLoginErr(data.error || "服务端未配置 ADMIN_PASSWORD");
      return;
    }
    const data = await resp.json();
    setList(data.agents || []);
  };

  useEffect(() => {
    if (authed) loadFull();
  }, [authed]);

  const tryLogin = async (e) => {
    e?.preventDefault();
    const pwd = loginPwd.trim();
    if (!pwd) {
      setLoginErr("请输入管理口令");
      return;
    }
    setLoginBusy(true);
    setLoginErr("");
    try {
      const resp = await fetch("/api/agents?full=1", {
        headers: {
          Authorization: `Bearer ${pwd}`,
          "X-Admin-Password": pwd,
        },
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 401) {
        setLoginErr("口令不正确，请检查后重试");
        return;
      }
      if (resp.status === 503) {
        setLoginErr(data.error || "服务端未配置 ADMIN_PASSWORD");
        return;
      }
      if (!resp.ok) {
        setLoginErr(data.error || "验证失败");
        return;
      }
      setStoredAdminPassword(pwd);
      setAuthed(true);
      setList(data.agents || []);
      setLoginPwd("");
    } catch (err) {
      setLoginErr(err.message || "网络错误");
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = () => {
    clearStoredAdminPassword();
    setAuthed(false);
    setList([]);
    setEditing(null);
    setVersions([]);
    setMsg("");
    setLoginErr("");
  };

  const startNew = () => { setEditing({ ...EMPTY }); setVersions([]); setMsg(""); };
  const startEdit = async (a) => {
    setEditing({ ...a, samples: a.samples || [] });
    setMsg("");
    const resp = await adminFetch(`/api/versions?id=${a.id}`);
    const data = await resp.json();
    setVersions(data.versions || []);
  };

  const save = async () => {
    if (!editing.id || !editing.name || !editing.system) {
      setMsg("id、名称、system prompt 都是必填的");
      return;
    }
    setBusy(true); setMsg("");
    try {
      const resp = await adminFetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await resp.json();
      if (resp.status === 401) {
        logout();
        return;
      }
      if (!resp.ok) { setMsg(data.error); return; }
      setMsg("已保存，立即生效");
      await loadFull();
      onChanged?.();
    } catch (e) {
      setMsg(e.message);
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm(`确定删除 Agent「${id}」？`)) return;
    setBusy(true);
    try {
      const resp = await adminFetch(`/api/agents?id=${id}`, { method: "DELETE" });
      if (resp.status === 401) {
        logout();
        return;
      }
      setEditing(null);
      await loadFull();
      onChanged?.();
    } finally { setBusy(false); }
  };

  const rollback = (v) => {
    if (!confirm("用这个历史版本覆盖当前编辑内容？（保存后才真正生效）")) return;
    const { savedAt, ...rest } = v;
    setEditing({ ...rest, samples: rest.samples || [] });
    setMsg("已载入历史版本，确认后点保存生效");
  };

  const set = (k, val) => setEditing((e) => ({ ...e, [k]: val }));

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin" onClick={(e) => e.stopPropagation()}>
        <div className="admin-head">
          <h2>⚙ Agent 管理</h2>
          <div className="admin-head-actions">
            {authed && (
              <button type="button" className="logout-btn" onClick={logout}>
                退出登录
              </button>
            )}
            <button className="x" onClick={onClose}>✕</button>
          </div>
        </div>

        {!authed ? (
          <form className="admin-login" onSubmit={tryLogin}>
            <p className="admin-login-hint">
              请输入部署时配置的 <code>ADMIN_PASSWORD</code> 管理口令。
            </p>
            <label>
              管理口令
              <input
                type="password"
                value={loginPwd}
                onChange={(e) => setLoginPwd(e.target.value)}
                placeholder="与 Vercel 环境变量一致"
                autoFocus
              />
            </label>
            {loginErr && <div className="admin-login-err">{loginErr}</div>}
            <button type="submit" className="save-btn" disabled={loginBusy}>
              {loginBusy ? "验证中…" : "进入管理后台"}
            </button>
          </form>
        ) : (
          <>
            {!editable && (
              <div className="warn">
                当前未配置数据库（Vercel KV），处于只读模式，无法保存。
                配置后即可在线新建、编辑、回滚 Agent，且改完立即生效、无需重新部署。
              </div>
            )}

            <div className="admin-body">
              <div className="admin-list">
                <button className="new-btn" onClick={startNew} disabled={!editable}>＋ 新建 Agent</button>
                {list.map((a) => (
                  <div
                    key={a.id}
                    className={`list-item ${editing?.id === a.id ? "active" : ""}`}
                    onClick={() => startEdit(a)}
                  >
                    <span style={{ color: a.accent }}>{a.icon}</span>
                    <span className="li-name">{a.name}</span>
                    <span className="li-id">{a.id}</span>
                  </div>
                ))}
              </div>

              <div className="admin-form">
                {!editing ? (
                  <div className="empty-hint">从左侧选一个 Agent 编辑，或新建一个。</div>
                ) : (
                  <>
                    <div className="form-row two">
                      <label>
                        ID（英文，不可重复）
                        <input value={editing.id} onChange={(e) => set("id", e.target.value)}
                          placeholder="如 sales-coach" disabled={list.some((a) => a.id === editing.id)} />
                      </label>
                      <label>
                        图标
                        <input value={editing.icon} onChange={(e) => set("icon", e.target.value)} placeholder="✦" />
                      </label>
                    </div>

                    <div className="form-row two">
                      <label>名称<input value={editing.name} onChange={(e) => set("name", e.target.value)} /></label>
                      <label>主题色<input type="color" value={editing.accent} onChange={(e) => set("accent", e.target.value)} /></label>
                    </div>

                    <label>一句话标语<input value={editing.tagline} onChange={(e) => set("tagline", e.target.value)} /></label>
                    <label>描述<input value={editing.desc} onChange={(e) => set("desc", e.target.value)} /></label>
                    <label>开场白<input value={editing.greeting} onChange={(e) => set("greeting", e.target.value)} /></label>
                    <label>输入框提示<input value={editing.placeholder} onChange={(e) => set("placeholder", e.target.value)} /></label>

                    <label>
                      示例问题（每行一个）
                      <textarea rows={3}
                        value={(editing.samples || []).join("\n")}
                        onChange={(e) => set("samples", e.target.value.split("\n").filter(Boolean))} />
                    </label>

                    <label>
                      温度（0 稳定 ~ 1 活泼）：{editing.temperature}
                      <input type="range" min="0" max="1" step="0.1"
                        value={editing.temperature}
                        onChange={(e) => set("temperature", parseFloat(e.target.value))} />
                    </label>

                    <label>
                      System Prompt（Agent 的灵魂）
                      <textarea className="system-area" rows={12}
                        value={editing.system} onChange={(e) => set("system", e.target.value)} />
                    </label>

                    {msg && <div className="form-msg">{msg}</div>}

                    <div className="form-actions">
                      <button className="save-btn" onClick={save} disabled={busy || !editable}>
                        {busy ? "保存中…" : "保存（立即生效）"}
                      </button>
                      {list.some((a) => a.id === editing.id) && (
                        <button className="del-btn" onClick={() => remove(editing.id)} disabled={busy || !editable}>
                          删除
                        </button>
                      )}
                    </div>

                    {versions.length > 0 && (
                      <div className="versions">
                        <div className="versions-title">历史版本（点击载入回滚）</div>
                        {versions.map((v, i) => (
                          <div key={i} className="version-item" onClick={() => rollback(v)}>
                            <span>{new Date(v.savedAt).toLocaleString("zh-CN")}</span>
                            <span className="v-preview">{(v.system || "").slice(0, 30)}…</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
