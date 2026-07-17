// 可执行工具注册表。
//
// 这是 skills 从「注入 prompt 的文字」升级为「模型真能调用的函数」的地方：
// Agent 配置里的 skill 加一个 tool 字段指向此处的注册项，即成为真工具；
// 不带 tool 的 skill 保持原样（仍只注入 prompt），老配置不受影响。
//
// 新增工具 = 往 TOOL_REGISTRY 加一项，无需改 chat.js。

import { wallClockFromEpoch } from "./_runtime.js";

/** 单个工具最长执行时间，防止拖垮整轮对话 */
const TOOL_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------- 计算器

/**
 * 四则运算求值：手写递归下降，绝不用 eval/Function —— 表达式来自模型输出，
 * 等同于不可信输入，eval 会把任意代码执行权交出去。
 * 文法：expr := term (('+'|'-') term)* ; term := factor (('*'|'/'|'%') factor)*
 *      factor := unary ('^' factor)? ; unary := ('-'|'+')? primary
 *      primary := number | '(' expr ')'
 * @param {string} src
 * @returns {number}
 */
function evalArithmetic(src) {
  const tokens = String(src).match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens) throw new Error("表达式为空或含不支持的字符");
  if (tokens.join("") !== String(src).replace(/[\s,，]/g, "")) {
    throw new Error("表达式含不支持的字符（仅支持数字与 + - * / % ^ ( )）");
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => { if (tokens[pos] === t) { pos++; return true; } return false; };

  function primary() {
    if (eat("(")) {
      const v = expr();
      if (!eat(")")) throw new Error("括号不匹配");
      return v;
    }
    const t = peek();
    if (t === undefined || !/^\d/.test(t)) throw new Error("表达式不完整");
    pos++;
    return Number(t);
  }

  function unary() {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return primary();
  }

  function factor() {
    const base = unary();
    if (eat("^")) return Math.pow(base, factor()); // 右结合
    return base;
  }

  function term() {
    let v = factor();
    for (;;) {
      if (eat("*")) v *= factor();
      else if (eat("/")) {
        const d = factor();
        if (d === 0) throw new Error("除数不能为 0");
        v /= d;
      } else if (eat("%")) {
        const d = factor();
        if (d === 0) throw new Error("取模的除数不能为 0");
        v %= d;
      } else return v;
    }
  }

  function expr() {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }

  const result = expr();
  if (pos < tokens.length) throw new Error("表达式有多余内容");
  if (!Number.isFinite(result)) throw new Error("结果不是有限数");
  return result;
}

// ---------------------------------------------------------------- 注册表

export const TOOL_REGISTRY = {
  calculator: {
    definition: {
      type: "function",
      function: {
        name: "calculator",
        description:
          "计算数学表达式并返回精确结果。涉及任何算术（成本、工时、投入产出、比例等）都应调用本工具，不要心算。",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "数学表达式，如 (1200*12-3000)/8。支持 + - * / % ^ 与括号。",
            },
          },
          required: ["expression"],
        },
      },
    },
    /** @param {{expression:string}} args */
    async run(args) {
      const expression = String(args?.expression ?? "").trim();
      if (!expression) return { error: "缺少 expression 参数" };
      try {
        return { expression, result: evalArithmetic(expression) };
      } catch (err) {
        return { expression, error: err.message };
      }
    },
  },

  get_current_time: {
    definition: {
      type: "function",
      function: {
        name: "get_current_time",
        description:
          "获取用户当前的本地日期与时间。当需要知道现在几点、今天几号、或判断是否临近某个提醒时段时调用。",
        parameters: { type: "object", properties: {} },
      },
    },
    /** @param {object} _args @param {{clientTime?:string, tzOffset?:number}} ctx */
    async run(_args, ctx) {
      const tzOffset = Number.isFinite(ctx?.tzOffset) ? ctx.tzOffset : 480;
      const local = wallClockFromEpoch(Date.now(), tzOffset);
      const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const weekday = weekdays[new Date(Date.now() + tzOffset * 60000).getUTCDay()];
      return { localTime: local.dateStr, timeOfDay: local.timeStr, weekday, tzOffset };
    },
  },

  list_agents: {
    definition: {
      type: "function",
      function: {
        name: "list_agents",
        description:
          "列出本工作台当前有哪些 Agent 及其定位与技能。当用户问「这里有哪些 Agent」「你还能干什么」「谁能处理 X」时调用。",
        parameters: { type: "object", properties: {} },
      },
    },
    /** @param {object} _args @param {{allAgents?:object[]}} ctx */
    async run(_args, ctx) {
      const agents = Array.isArray(ctx?.allAgents) ? ctx.allAgents : [];
      return {
        count: agents.length,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          tagline: a.tagline || "",
          skills: (a.skills || []).map((s) => s.name),
        })),
      };
    },
  },
};

/**
 * 供管理后台下拉选择的工具清单。
 * 从注册表推导，避免前端硬编码一份副本导致漂移。
 * @returns {Array<{name:string, description:string}>}
 */
export function listAvailableTools() {
  return Object.entries(TOOL_REGISTRY).map(([name, entry]) => ({
    name,
    description: entry.definition.function.description,
  }));
}

/**
 * 由 Agent 的 skills 推导出可用工具定义。
 * 只有配了 tool 且能在注册表中找到的 skill 才成为工具。
 * @param {Array<{tool?:string}>|undefined} skills
 * @returns {object[]} OpenAI 兼容的 tools 数组
 */
export function buildToolDefinitions(skills) {
  if (!Array.isArray(skills)) return [];
  const seen = new Set();
  const defs = [];
  for (const skill of skills) {
    const key = skill?.tool;
    if (!key || seen.has(key)) continue;
    const entry = TOOL_REGISTRY[key];
    if (!entry) continue;
    seen.add(key);
    defs.push(entry.definition);
  }
  return defs;
}

/**
 * 查 skill 配的展示名，用于前端「正在使用技能 · XX」提示
 * @param {Array<{tool?:string, name?:string, icon?:string}>|undefined} skills
 * @param {string} toolName
 */
export function describeTool(skills, toolName) {
  const skill = (skills || []).find((s) => s?.tool === toolName);
  return {
    name: skill?.name || toolName,
    icon: skill?.icon || "🔧",
  };
}

/**
 * 执行一个工具调用。任何失败都以 { error } 形式返回给模型，让它自己决定怎么说，
 * 而不是抛出去中断整轮对话。
 * @param {string} name
 * @param {string} argsJson - 模型给的 JSON 字符串参数
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function executeTool(name, argsJson, ctx) {
  const entry = TOOL_REGISTRY[name];
  if (!entry) return { error: `未知工具：${name}` };

  let args = {};
  if (argsJson && String(argsJson).trim()) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      return { error: "参数不是合法 JSON" };
    }
  }

  try {
    return await Promise.race([
      entry.run(args, ctx || {}),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("工具执行超时")), TOOL_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    return { error: `工具执行失败：${err.message}` };
  }
}

export { evalArithmetic };
