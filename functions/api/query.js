// Cloudflare Pages Function：/api/query
// 职责：代理 new-api 的 /api/usage/token 查询接口，同源调用规避 CORS 并隐藏后端地址

import { json, readJson } from '../_lib/http.js';
import { loadSites, normalizeBackend } from '../_lib/site-store.js';

const TIMEOUT_MS = 8000;
// new-api 的查询接口真实路径带末尾斜杠（/api/usage/token/）。
// 不带斜杠会触发上游 301 重定向，部分网关/代理会剥离 Authorization 头，
// 结果表现为有效密钥也被当成 Invalid token 返回 401。
const USAGE_PATH = '/api/usage/token/';

function parseAllowed(env) {
  const raw = (env?.ALLOWED_BACKENDS || '').trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map(s => normalizeBackend(s.trim()))
    .filter(Boolean);
}

function getBackendPathname(backend) {
  try {
    return new URL(backend).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getBackendOrigin(backend) {
  try {
    return new URL(backend).origin;
  } catch {
    return null;
  }
}

export function buildUsageUrl(backend) {
  const normalized = normalizeBackend(backend);
  if (!normalized) return null;
  return new URL(USAGE_PATH.replace(/^\//, ''), `${normalized}/`).toString();
}

export function isAllowedBackend(backend, allowed) {
  if (!allowed?.length) return true;

  const normalizedBackend = normalizeBackend(backend);
  if (!normalizedBackend) return false;

  const backendOrigin = getBackendOrigin(normalizedBackend);
  return allowed.some(entry => {
    const normalizedEntry = normalizeBackend(entry);
    if (!normalizedEntry) return false;

    const entryPath = getBackendPathname(normalizedEntry);
    if (!entryPath || entryPath === '/') {
      return getBackendOrigin(normalizedEntry) === backendOrigin;
    }
    return normalizedEntry === normalizedBackend;
  });
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) {
    return json({ success: false, message: '请求体必须是 JSON' }, 400);
  }

  const siteId = String(body?.siteId || '').trim();
  let backend = null;
  if (siteId) {
    try {
      const sites = await loadSites(env);
      const site = sites.find(item => item.id === siteId);
      if (!site) {
        return json({ success: false, message: '站点不存在，请刷新页面后重试' }, 404);
      }
      if (!site.enabled) {
        return json({ success: false, message: '该站点已停用，请选择其他站点' }, 403);
      }
      backend = normalizeBackend(site.url);
      if (!backend) {
        return json({ success: false, message: '站点地址无效，请联系管理员修复' }, 500);
      }
    } catch (error) {
      return json({ success: false, message: error.message || '读取站点配置失败' }, 500);
    }
  }

  if (!backend) {
    backend = normalizeBackend(body?.backend || '');
  }
  const rawKey = (body?.key || '').trim();
  const key = rawKey.startsWith('sk-') ? rawKey : (rawKey ? 'sk-' + rawKey : '');

  if (!backend) {
    return json({ success: false, message: '查询站点无效，请刷新页面后重试' }, 400);
  }
  if (!key) {
    return json({ success: false, message: '请输入 API 密钥' }, 400);
  }

  const allowed = parseAllowed(env);
  if (!isAllowedBackend(backend, allowed)) {
    return json({ success: false, message: '该后端未在白名单内，请联系商家' }, 403);
  }

  const target = buildUsageUrl(backend);
  if (!target) {
    return json({ success: false, message: '查询站点无效，请刷新页面后重试' }, 400);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'User-Agent': 'new-api-key-query/1.0',
      },
      signal: ctrl.signal,
    });

    const text = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON 响应 */ }

    if (upstream.status === 401) {
      return json({ success: false, message: parsed?.message || '密钥无效或已删除' }, 401);
    }
    if (upstream.status === 404) {
      return json({ success: false, message: '后端未提供该接口，可能 new-api 版本过旧' }, 404);
    }
    if (!upstream.ok) {
      return json(
        { success: false, message: parsed?.message || `上游错误（${upstream.status}）` },
        upstream.status,
      );
    }

    return json(parsed ?? { success: true, raw: text });
  } catch (e) {
    if (e.name === 'AbortError') {
      return json({ success: false, message: '后端响应超时，请稍后重试' }, 504);
    }
    return json({ success: false, message: '无法连接后端：' + (e.message || 'unknown') }, 502);
  } finally {
    clearTimeout(timer);
  }
}

// 探活
export async function onRequestGet() {
  return json({ success: true, message: 'pong' });
}
