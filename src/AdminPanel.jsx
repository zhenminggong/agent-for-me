import { useState, useEffect, useRef } from "react";
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
  skills: [], agentLinks: [], schedule: null,
};

const EMPTY_SKILL = { id: "", name: "", desc: "", icon: "✦" };
const EMPTY_LINK = { targetId: "", label: "", trigger: "" };
const EMPTY_REMINDER = { time: "09:00", label: "" };

/** 确保 schedule 对象结构完整 */
function normalizeSchedule(schedule) {
  if (!schedule) return { rhythm: "gentle", dailyReminders: [], careTopics: [] };
  return {
    rhythm: schedule.rhythm || "gentle",
    dailyReminders: Array.isArray(schedule.dailyReminders) ? schedule.dailyReminders : [],
    careTopics: Array.isArray(schedule.careTopics) ? schedule.careTopics : [],
  };
}

export default function AdminPanel({
  editable,
  onClose,
  onChanged,
  focusAgentId = null,
  focusSection = null,
}) {
  const [authed, setAuthed] = useState(!!getStoredAdminPassword());
  const [loginPwd, setLoginPwd] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState("");

  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  /** 避免同一 focus 参数重复触发编辑与滚动 */
  const focusAppliedRef = useRef("");

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
    setEditing({
      ...a,
      samples: a.samples || [],
      skills: a.skills || [],
      agentLinks: a.agentLinks || [],
      schedule: a.schedule ? normalizeSchedule(a.schedule) : null,
    });
    setMsg("");
    const resp = await adminFetch(`/api/versions?id=${a.id}`);
    const data = await resp.json();
    setVersions(data.versions || []);
  };

  /** 登录后根据 URL 参数自动打开指定 Agent 并滚动到区块 */
  useEffect(() => {
    if (!authed || !list.length || !focusAgentId) return;

    const focusKey = `${focusAgentId}:${focusSection || ""}`;
    if (focusAppliedRef.current === focusKey) return;

    const target = list.find((a) => a.id === focusAgentId);
    if (!target) return;

    focusAppliedRef.current = focusKey;

    (async () => {
      await startEdit(target);
      if (focusSection === "skills") {
        window.setTimeout(() => {
          document.getElementById("admin-skills-section")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 80);
      }
    })();
  }, [authed, list, focusAgentId, focusSection]);

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
    setEditing({
      ...rest,
      samples: rest.samples || [],
      skills: rest.skills || [],
      agentLinks: rest.agentLinks || [],
      schedule: rest.schedule ? normalizeSchedule(rest.schedule) : null,
    });
    setMsg("已载入历史版本，确认后点保存生效");
  };

  const set = (k, val) => setEditing((e) => ({ ...e, [k]: val }));

  /** 更新 skills 数组中某一项 */
  const updateSkill = (idx, field, val) => {
    setEditing((e) => {
      const skills = [...(e.skills || [])];
      skills[idx] = { ...skills[idx], [field]: val };
      return { ...e, skills };
    });
  };

  const addSkill = () => {
    setEditing((e) => ({ ...e, skills: [...(e.skills || []), { ...EMPTY_SKILL }] }));
  };

  const removeSkill = (idx) => {
    setEditing((e) => ({
      ...e,
      skills: (e.skills || []).filter((_, i) => i !== idx),
    }));
  };

  /** 更新 agentLinks */
  const updateLink = (idx, field, val) => {
    setEditing((e) => {
      const agentLinks = [...(e.agentLinks || [])];
      agentLinks[idx] = { ...agentLinks[idx], [field]: val };
      return { ...e, agentLinks };
    });
  };

  const addLink = () => {
    setEditing((e) => ({ ...e, agentLinks: [...(e.agentLinks || []), { ...EMPTY_LINK }] }));
  };

  const removeLink = (idx) => {
    setEditing((e) => ({
      ...e,
      agentLinks: (e.agentLinks || []).filter((_, i) => i !== idx),
    }));
  };

  /** 更新 schedule */
  const setScheduleField = (field, val) => {
    setEditing((e) => ({
      ...e,
      schedule: { ...normalizeSchedule(e.schedule), [field]: val },
    }));
  };

  const toggleSchedule = (enabled) => {
    setEditing((e) => ({
      ...e,
      schedule: enabled ? normalizeSchedule(e.schedule) : null,
    }));
  };

  const updateReminder = (idx, field, val) => {
    setEditing((e) => {
      const schedule = normalizeSchedule(e.schedule);
      const dailyReminders = [...schedule.dailyReminders];
      dailyReminders[idx] = { ...dailyReminders[idx], [field]: val };
      return { ...e, schedule: { ...schedule, dailyReminders } };
    });
  };

  const addReminder = () => {
    setEditing((e) => {
      const schedule = normalizeSchedule(e.schedule);
      return {
        ...e,
        schedule: {
          ...schedule,
          dailyReminders: [...schedule.dailyReminders, { ...EMPTY_REMINDER }],
        },
      };
    });
  };

  const removeReminder = (idx) => {
    setEditing((e) => {
      const schedule = normalizeSchedule(e.schedule);
      return {
        ...e,
        schedule: {
          ...schedule,
          dailyReminders: schedule.dailyReminders.filter((_, i) => i !== idx),
        },
      };
    });
  };

  /** 其他 agent id，供 handoff 目标下拉 */
  const otherAgentIds = list.filter((a) => a.id !== editing?.id).map((a) => a.id);

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
              {focusAgentId && (
                <span className="admin-login-focus-hint">
                  {" "}登录后将自动打开 Agent「{focusAgentId}」
                  {focusSection === "skills" ? " 的技能配置" : " 的编辑页"}。
                </span>
              )}
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

                    <div className="admin-section" id="admin-skills-section">
                      <div className="admin-section-head">
                        <span className="admin-section-title">⚡ 技能能力</span>
                        <button type="button" className="mini-add-btn" onClick={addSkill}>＋ 添加</button>
                      </div>
                      {(editing.skills || []).map((sk, i) => (
                        <div key={i} className="admin-card-row">
                          <input
                            className="mini-input"
                            value={sk.icon || ""}
                            onChange={(e) => updateSkill(i, "icon", e.target.value)}
                            placeholder="图标"
                            title="图标"
                          />
                          <input
                            className="mini-input"
                            value={sk.id || ""}
                            onChange={(e) => updateSkill(i, "id", e.target.value)}
                            placeholder="id"
                          />
                          <input
                            className="mini-input flex2"
                            value={sk.name || ""}
                            onChange={(e) => updateSkill(i, "name", e.target.value)}
                            placeholder="名称"
                          />
                          <input
                            className="mini-input flex3"
                            value={sk.desc || ""}
                            onChange={(e) => updateSkill(i, "desc", e.target.value)}
                            placeholder="描述"
                          />
                          <button type="button" className="mini-del-btn" onClick={() => removeSkill(i)}>✕</button>
                        </div>
                      ))}
                    </div>

                    <div className="admin-section">
                      <div className="admin-section-head">
                        <span className="admin-section-title">🔗 协作编排（Handoff）</span>
                        <button type="button" className="mini-add-btn" onClick={addLink}>＋ 添加</button>
                      </div>
                      {(editing.agentLinks || []).map((link, i) => (
                        <div key={i} className="admin-card-block">
                          <div className="admin-card-row">
                            <select
                              className="mini-input flex2"
                              value={link.targetId || ""}
                              onChange={(e) => updateLink(i, "targetId", e.target.value)}
                            >
                              <option value="">选择目标 Agent</option>
                              {otherAgentIds.map((id) => (
                                <option key={id} value={id}>{id}</option>
                              ))}
                            </select>
                            <input
                              className="mini-input flex2"
                              value={link.label || ""}
                              onChange={(e) => updateLink(i, "label", e.target.value)}
                              placeholder="显示标签"
                            />
                            <button type="button" className="mini-del-btn" onClick={() => removeLink(i)}>✕</button>
                          </div>
                          <input
                            className="mini-input full"
                            value={link.trigger || ""}
                            onChange={(e) => updateLink(i, "trigger", e.target.value)}
                            placeholder="触发条件简述"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="admin-section">
                      <div className="admin-section-head">
                        <span className="admin-section-title">📅 陪伴日程</span>
                        <label className="schedule-toggle">
                          <input
                            type="checkbox"
                            checked={!!editing.schedule}
                            onChange={(e) => toggleSchedule(e.target.checked)}
                          />
                          启用
                        </label>
                      </div>
                      {editing.schedule && (
                        <>
                          <label>
                            陪伴节奏
                            <select
                              value={editing.schedule.rhythm || "gentle"}
                              onChange={(e) => setScheduleField("rhythm", e.target.value)}
                            >
                              <option value="gentle">温和节奏</option>
                              <option value="active">主动关怀</option>
                              <option value="quiet">安静陪伴</option>
                            </select>
                          </label>
                          <div className="admin-sub-label">每日提醒时段</div>
                          {(editing.schedule.dailyReminders || []).map((r, i) => (
                            <div key={i} className="admin-card-row">
                              <input
                                className="mini-input"
                                type="time"
                                value={r.time || "09:00"}
                                onChange={(e) => updateReminder(i, "time", e.target.value)}
                              />
                              <input
                                className="mini-input flex3"
                                value={r.label || ""}
                                onChange={(e) => updateReminder(i, "label", e.target.value)}
                                placeholder="提醒内容"
                              />
                              <button type="button" className="mini-del-btn" onClick={() => removeReminder(i)}>✕</button>
                            </div>
                          ))}
                          <button type="button" className="mini-add-btn block" onClick={addReminder}>＋ 添加时段</button>
                          <label>
                            关心话题（每行一个）
                            <textarea
                              rows={2}
                              value={(editing.schedule.careTopics || []).join("\n")}
                              onChange={(e) => setScheduleField(
                                "careTopics",
                                e.target.value.split("\n").filter(Boolean)
                              )}
                            />
                          </label>
                        </>
                      )}
                    </div>

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
