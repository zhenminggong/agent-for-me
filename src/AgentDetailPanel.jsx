/**
 * Agent 详情侧栏：展示技能、协作编排、陪伴日程。
 * 前台只读展示，数据来自 /api/agents 公开字段。
 */

import { useState } from "react";

/** 根据 targetId 在 agents 列表中查找名称 */
function resolveAgentName(agents, targetId) {
  return agents.find((a) => a.id === targetId)?.name || targetId;
}

/**
 * 可折叠详情区块（默认收起，点击标题展开）
 * @param {string} id - 区块 id，用于 aria 关联
 * @param {string} title - 标题文案
 * @param {string} icon - 标题图标
 * @param {boolean} defaultOpen - 是否默认展开
 * @param {React.ReactNode} titleExtra - 标题行额外操作（如配置入口）
 * @param {React.ReactNode} summary - 收起时在标题旁显示的摘要
 * @param {React.ReactNode} badge - 右侧徽章（如「运行时」）
 */
function DetailAccordion({
  id,
  title,
  icon,
  defaultOpen = false,
  titleExtra,
  summary,
  badge,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`detail-section detail-accordion${open ? " open" : ""}`}>
      <div className="detail-accordion-head">
        <button
          type="button"
          className="detail-accordion-trigger"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
        >
          <span className="detail-section-title">
            <span className="detail-icon">{icon}</span>
            {title}
            {!open && summary && (
              <span className="detail-accordion-summary">{summary}</span>
            )}
            {badge}
            <span className="detail-accordion-chevron" aria-hidden>▾</span>
          </span>
        </button>
        {titleExtra}
      </div>
      <div
        id={`${id}-panel`}
        className="detail-accordion-panel"
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}

/** 技能卡片网格（可折叠，默认收起） */
function SkillsSection({ skills, agentId, onConfigureSkills }) {
  if (!skills?.length) return null;

  const configLink = (
    <a
      href={`#/admin?agent=${encodeURIComponent(agentId)}&section=skills`}
      className="detail-config-link"
      title="打开管理后台配置技能（需登录）"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onConfigureSkills?.(agentId);
      }}
    >
      ⚙ 配置
    </a>
  );

  return (
    <DetailAccordion
      id="skills"
      icon="⚡"
      title="技能能力"
      defaultOpen={false}
      summary={`${skills.length} 项`}
      titleExtra={configLink}
      badge={
        <span className="runtime-badge" title="已注入对话 system prompt">
          运行时
        </span>
      }
    >
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
    </DetailAccordion>
  );
}

/** 多 Agent 协作 / handoff 链路（可折叠，默认收起） */
function LinksSection({ links, agents, onSwitchAgent }) {
  if (!links?.length) return null;

  return (
    <DetailAccordion
      id="links"
      icon="🔗"
      title="协作编排"
      defaultOpen={false}
      summary={`${links.length} 条`}
      badge={
        <span className="runtime-badge" title="LLM 可输出 handoff，前端一键切换">
          运行时
        </span>
      }
    >
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
    </DetailAccordion>
  );
}

/** 陪伴 Agent 日程时间轴（保持展开） */
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
        <span className="runtime-badge" title="注入 prompt + 客户端时间感知">
          运行时
        </span>
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
 * @param {function} onConfigureSkills - 打开管理后台并定位到技能编辑区
 */
export default function AgentDetailPanel({
  agent,
  agents = [],
  onSwitchAgent,
  onConfigureSkills,
}) {
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
      <SkillsSection
        skills={agent.skills}
        agentId={agent.id}
        onConfigureSkills={onConfigureSkills}
      />
      <LinksSection
        links={agent.agentLinks}
        agents={agents}
        onSwitchAgent={onSwitchAgent}
      />
      <ScheduleSection schedule={agent.schedule} />
    </aside>
  );
}
