// Cloudflare Pages Function：/api/query
// 职责：代理 new-api 的 /api/usage/token 查询接口，同源调用规避 CORS 并隐藏后端地址

const TIMEOUT_MS = 8000;
const USAGE_PATH = '/api/usage/token';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function normalizeBackend(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function parseAllowed(env) {
  const raw = (env?.ALLOWED_BACKENDS || '').trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map(s => normalizeBackend(s.trim()))
    .filter(Boolean);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: '请求体必须是 JSON' }, 400);
  }

  const backend = normalizeBackend(body?.backend || '');
  const rawKey = (body?.key || '').trim();
  const key = rawKey.startsWith('sk-') ? rawKey : (rawKey ? 'sk-' + rawKey : '');

  if (!backend) {
    return json({ success: false, message: '后端地址无效，请检查 config.js 或自定义输入' }, 400);
  }
  if (!key) {
    return json({ success: false, message: '请输入 API 密钥' }, 400);
  }

  const allowed = parseAllowed(env);
  if (allowed && !allowed.includes(backend)) {
    return json({ success: false, message: '该后端未在白名单内，请联系商家' }, 403);
  }

  const target = backend + USAGE_PATH;
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
