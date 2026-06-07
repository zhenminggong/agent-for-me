// 管理后台口令：存 sessionStorage，请求时带上鉴权头

const STORAGE_KEY = "adminPassword";

/**
 * 读取已保存的管理口令
 * @returns {string}
 */
export function getStoredAdminPassword() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * 保存管理口令到 sessionStorage
 * @param {string} password
 */
export function setStoredAdminPassword(password) {
  sessionStorage.setItem(STORAGE_KEY, password);
}

/**
 * 清除已保存的管理口令
 */
export function clearStoredAdminPassword() {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * 构造管理 API 所需的鉴权请求头
 * @returns {Record<string, string>}
 */
export function buildAdminHeaders() {
  const pwd = getStoredAdminPassword();
  if (!pwd) return {};
  return {
    Authorization: `Bearer ${pwd}`,
    "X-Admin-Password": pwd,
  };
}

/**
 * 带鉴权头的 fetch 封装（合并 Content-Type 等）
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export function adminFetch(url, options = {}) {
  const headers = {
    ...buildAdminHeaders(),
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}
