// 管理接口鉴权：口令来自环境变量 ADMIN_PASSWORD
// 请求头支持 Authorization: Bearer <password> 或 X-Admin-Password: <password>

/**
 * 读取服务端配置的管理口令（未配置时为空字符串）
 * @returns {string}
 */
export function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "";
}

/**
 * 从请求头解析客户端提交的管理口令
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
export function extractAdminToken(req) {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const headerPwd = req.headers["x-admin-password"];
  if (headerPwd) return String(headerPwd).trim();
  return null;
}

/**
 * 校验管理口令；失败时已写入 res 响应
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean} 通过为 true
 */
export function requireAdmin(req, res) {
  const configured = getAdminPassword();
  if (!configured) {
    res.status(503).json({
      error:
        "未配置 ADMIN_PASSWORD，管理接口不可用。请在环境变量中设置 ADMIN_PASSWORD。",
    });
    return false;
  }
  const token = extractAdminToken(req);
  if (!token || token !== configured) {
    res.status(401).json({ error: "管理口令错误或未提供" });
    return false;
  }
  return true;
}
