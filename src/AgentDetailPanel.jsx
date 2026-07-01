/**
 * Agent 详情侧栏：展示技能、协作编排、陪伴日程。
 * 前台只读展示，数据来自 /api/agents 公开字段。
 */

/** 根据 targetId 在 agents 列表中查找名称 */
function resolveAgentName(agents, targetId) {
  return agents.find((a) => a.id === targetId)?.name || targetId;
}

/** 技能卡片网格 */
function SkillsSection({ skills }) {
  if (!skills?.length) return null;
  return (
    <section className="detail-section">
      <h3 className="detail-section-title">
        <span className="detail-icon">⚡</span>
        技能能力
        <span className="runtime-badge" title="已注入对话 system prompt">运行时</span>
      </h3>
      <div className="skills-grid">
        {skills.map((s) => (
          <div key={s.id} className="skill-card">
            <span className="skill-card-icon">{s.icon || "✦"}</span>
            <div className="skill-card-body">
              <span className="skill-card-name">{s.name}</span>
              {s.desc && <span className="skill-card-desc">{s.desc}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 多 Agent 协作 / handoff 链路 */
function LinksSection({ links, agents, onSwitchAgent }) {
  if (!links?.length) return null;
  return (
    <section className="detail-section">
      <h3 className="detail-section-title">
        <span className="detail-icon">🔗</span>
        协作编排
        <span className="runtime-badge" title="LLM 可输出 handoff，前端一键切换">运行时</span>
      </h3>
      <div className="links-list">
        {links.map((link, i) => (
          <div key={i} className="link-card">
            <div className="link-card-head">
              <span className="link-arrow">→</span>
              <button
                type="button"
                className="link-target-btn"
                onClick={() => onSwitchAgent?.(link.targetId)}
                title={`切换到 ${resolveAgentName(agents, link.targetId)}`}
              >
                {link.label || resolveAgentName(agents, link.targetId)}
              </button>
            </div>
            {link.trigger && (
              <p className="link-trigger">
                <span className="link-trigger-label">触发</span>
                {link.trigger}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 陪伴 Agent 日程时间轴 */
function ScheduleSection({ schedule }) {
  if (!schedule) return null;
  const { rhythm, dailyReminders = [], careTopics = [] } = schedule;
  const hasContent = rhythm || dailyReminders.length || careTopics.length;
  if (!hasContent) return null;

  const rhythmLabels = {
    gentle: "温和节奏",
    active: "主动关怀",
    quiet: "安静陪伴",
  };

  return (
    <section className="detail-section">
      <h3 className="detail-section-title">
        <span className="detail-icon">📅</span>
        陪伴日程
        <span className="runtime-badge" title="注入 prompt + 客户端时间感知">运行时</span>
      </h3>

      {rhythm && (
        <div className="schedule-rhythm">
          <span className="schedule-tag">{rhythmLabels[rhythm] || rhythm}</span>
        </div>
      )}

      {dailyReminders.length > 0 && (
        <div className="schedule-timeline">
          {dailyReminders.map((item, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot" />
              <div className="timeline-content">
                <span className="timeline-time">{item.time}</span>
                <span className="timeline-label">{item.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {careTopics.length > 0 && (
        <div className="care-topics">
          <span className="care-topics-label">关心话题</span>
          <div className="care-topic-tags">
            {careTopics.map((t, i) => (
              <span key={i} className="care-topic-tag">{t}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Agent 详情面板主组件
 * @param {object} agent - 当前 Agent 配置
 * @param {object[]} agents - 全部 Agent（用于解析 handoff 目标名）
 * @param {function} onSwitchAgent - 点击协作目标时切换 Agent
 */
export default function AgentDetailPanel({ agent, agents = [], onSwitchAgent }) {
  if (!agent) return null;

  const hasSkills = agent.skills?.length > 0;
  const hasLinks = agent.agentLinks?.length > 0;
  const hasSchedule = agent.schedule && (
    agent.schedule.rhythm ||
    agent.schedule.dailyReminders?.length ||
    agent.schedule.careTopics?.length
  );

  if (!hasSkills && !hasLinks && !hasSchedule) {
    return (
      <aside className="agent-detail empty">
        <p className="detail-empty-hint">暂无能力配置</p>
      </aside>
    );
  }

  return (
    <aside className="agent-detail">
      <SkillsSection skills={agent.skills} />
      <LinksSection
        links={agent.agentLinks}
        agents={agents}
        onSwitchAgent={onSwitchAgent}
      />
      <ScheduleSection schedule={agent.schedule} />
    </aside>
  );
}
