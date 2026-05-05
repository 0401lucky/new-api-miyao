// Cloudflare Pages Function：/api/query
// 支持按站点类型查询：
// - new-api / one-api：代理 /api/usage/token/（信息最全：令牌名、到期、模型白名单等）
// - sub2api：代理 /v1/usage（直接使用用户 API Key 鉴权）
//
// new-api 主路：
// 代理 /api/usage/token/
// 回退：当主路被 WAF / JS 质询挡住（返回 HTML）时，改走 OpenAI 兼容的
//       /v1/dashboard/billing/subscription + /v1/dashboard/billing/usage。
//       这两个路径通常不能被站点拦截，否则 OpenAI / Claude Code 客户端也用不了。

import { json, readJson } from '../_lib/http.js';
import { loadSites, normalizeBackend, normalizeSiteType } from '../_lib/site-store.js';

const TIMEOUT_MS = 8000;
// new-api 的原生查询接口路径带末尾斜杠（/api/usage/token/）。
// 不带斜杠会触发 301 重定向，部分网关在跟随重定向时剥离 Authorization 头。
const USAGE_PATH = '/api/usage/token/';
const SUB2API_USAGE_PATH = '/v1/usage';
// new-api 和 one-api 都实现了 OpenAI Billing API 兼容路径，用作回退。
const BILLING_SUB_PATH = '/v1/dashboard/billing/subscription';
const BILLING_USAGE_PATH = '/v1/dashboard/billing/usage';
// 1 USD = 500000 quota（new-api 和 one-api 的默认换算）。
const QUOTA_PER_USD = 500000;
// OpenAI Billing 的 total_usage 单位是美分。
const CENTS_PER_USD = 100;

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

function joinBackendPath(backend, path) {
  const normalized = normalizeBackend(backend);
  if (!normalized) return null;
  return new URL(path.replace(/^\//, ''), `${normalized}/`).toString();
}

export function buildUsageUrl(backend) {
  return joinBackendPath(backend, USAGE_PATH);
}

export function buildSub2ApiUsageUrl(backend) {
  return joinBackendPath(backend, SUB2API_USAGE_PATH);
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

function looksLikeChallenge(text) {
  return /<html|<script|acw_sc__v2|denied by/i.test(text || '');
}

function pickErrorMessage(parsed, fallback) {
  return parsed?.message || parsed?.error?.message || fallback;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function usdToQuota(usd) {
  const n = numberOrNull(usd);
  return n === null ? 0 : Math.max(0, n) * QUOTA_PER_USD;
}

function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) return 0;
    return numeric > 100000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function getSub2ApiPayload(parsed) {
  if (parsed?.data && typeof parsed.data === 'object' && !parsed.mode) {
    return parsed.data;
  }
  return parsed || {};
}

function pickSubscriptionWindow(subscription, fallbackRemaining) {
  if (!subscription || typeof subscription !== 'object') return null;

  const candidates = [
    {
      limit: numberOrNull(subscription.daily_limit_usd),
      used: numberOrNull(subscription.daily_usage_usd) ?? 0,
    },
    {
      limit: numberOrNull(subscription.weekly_limit_usd),
      used: numberOrNull(subscription.weekly_usage_usd) ?? 0,
    },
    {
      limit: numberOrNull(subscription.monthly_limit_usd),
      used: numberOrNull(subscription.monthly_usage_usd) ?? 0,
    },
  ]
    .filter(item => item.limit !== null && item.limit > 0)
    .map(item => ({
      ...item,
      remaining: Math.max(0, item.limit - item.used),
    }));

  if (!candidates.length) return null;

  const target = numberOrNull(fallbackRemaining);
  if (target !== null) {
    const matched = candidates.find(item => Math.abs(item.remaining - target) < 0.000001);
    if (matched) return matched;
  }
  return candidates.sort((a, b) => a.remaining - b.remaining)[0];
}

async function fetchJson(url, key, signal) {
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'new-api-key-query/1.0',
    },
    signal,
  });
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { resp, text, parsed };
}

export function normalizeSub2ApiUsageResponse(parsed) {
  if (parsed?.success === false) {
    return {
      success: false,
      message: pickErrorMessage(parsed, 'Sub2API 查询失败'),
    };
  }

  const payload = getSub2ApiPayload(parsed);
  if (payload?.isValid === false) {
    return {
      success: false,
      message: payload?.status ? `密钥状态异常：${payload.status}` : '密钥无效或不可用',
    };
  }

  const usageTotal = payload?.usage?.total || {};
  const usageCostUsd = numberOrNull(usageTotal.actual_cost ?? usageTotal.cost) ?? 0;
  const quota = payload?.quota && typeof payload.quota === 'object' ? payload.quota : null;
  const remainingUsd = numberOrNull(payload?.remaining);

  let totalUsd = 0;
  let usedUsd = usageCostUsd;
  let availableUsd = Math.max(0, remainingUsd ?? 0);
  let unlimited = false;

  if (quota && (numberOrNull(quota.limit) ?? 0) > 0) {
    totalUsd = numberOrNull(quota.limit) ?? 0;
    usedUsd = numberOrNull(quota.used) ?? usageCostUsd;
    availableUsd = numberOrNull(quota.remaining) ?? Math.max(0, totalUsd - usedUsd);
  } else if (payload?.subscription) {
    const picked = pickSubscriptionWindow(payload.subscription, remainingUsd);
    if (picked) {
      totalUsd = picked.limit;
      usedUsd = picked.used;
      availableUsd = picked.remaining;
    } else {
      unlimited = remainingUsd === null || remainingUsd < 0;
      availableUsd = unlimited ? 0 : Math.max(0, remainingUsd);
      totalUsd = unlimited ? 0 : availableUsd + usedUsd;
    }
  } else {
    unlimited = remainingUsd !== null && remainingUsd < 0;
    availableUsd = unlimited ? 0 : Math.max(0, remainingUsd ?? 0);
    totalUsd = unlimited ? 0 : availableUsd + usedUsd;
  }

  return {
    success: true,
    data: {
      name: payload?.planName || (payload?.mode === 'quota_limited' ? 'Sub2API 密钥' : 'Sub2API 余额'),
      unlimited_quota: unlimited,
      total_granted: usdToQuota(totalUsd),
      total_used: usdToQuota(usedUsd),
      total_available: usdToQuota(availableUsd),
      expires_at: toUnixSeconds(payload?.expires_at ?? payload?.subscription?.expires_at),
      model_limits_enabled: false,
      model_limits: {},
      provider: 'sub2api',
      status: payload?.status || '',
      mode: payload?.mode || '',
    },
  };
}

// 回退：走 OpenAI Billing 兼容接口合成出前端期望的字段结构。
async function queryViaBillingFallback(backend, key, signal) {
  const subUrl = joinBackendPath(backend, BILLING_SUB_PATH);
  const today = new Date();
  const end = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const usageUrl = `${joinBackendPath(backend, BILLING_USAGE_PATH)}?start_date=${start}&end_date=${end}`;

  const [sub, usage] = await Promise.all([
    fetchJson(subUrl, key, signal),
    fetchJson(usageUrl, key, signal),
  ]);

  if (sub.resp.status === 401) {
    return {
      kind: 'error',
      status: 401,
      message: pickErrorMessage(sub.parsed, '密钥无效或已删除'),
    };
  }
  if (!sub.resp.ok || !sub.parsed) {
    return {
      kind: 'error',
      status: 502,
      message: pickErrorMessage(sub.parsed, '该站点未开放 OpenAI 兼容接口，无法降级查询'),
    };
  }

  const totalUsd = Number(sub.parsed?.hard_limit_usd ?? 0);
  const unlimited = !!sub.parsed?.unlimited_quota;
  const expiresAt = Number(sub.parsed?.access_until ?? 0);
  const usedUsd = usage.resp.ok && usage.parsed
    ? Number(usage.parsed?.total_usage ?? 0) / CENTS_PER_USD
    : 0;
  const availableUsd = unlimited ? 0 : Math.max(0, totalUsd - usedUsd);

  return {
    kind: 'ok',
    data: {
      success: true,
      data: {
        name: sub.parsed?.plan?.title || '订阅令牌',
        unlimited_quota: unlimited,
        total_granted: totalUsd * QUOTA_PER_USD,
        total_used: usedUsd * QUOTA_PER_USD,
        total_available: availableUsd * QUOTA_PER_USD,
        expires_at: expiresAt,
        model_limits_enabled: false,
        model_limits: {},
      },
    },
  };
}

async function queryViaSub2Api(backend, key, signal) {
  const target = buildSub2ApiUsageUrl(backend);
  if (!target) {
    return json({ success: false, message: '查询站点无效，请刷新页面后重试' }, 400);
  }

  const result = await fetchJson(target, key, signal);
  if (result.resp.status === 401) {
    return json(
      { success: false, message: pickErrorMessage(result.parsed, '密钥无效或已删除') },
      401,
    );
  }
  if (result.resp.ok && result.parsed) {
    const normalized = normalizeSub2ApiUsageResponse(result.parsed);
    return json(normalized, normalized.success === false ? 403 : 200);
  }
  if (!result.resp.ok) {
    return json(
      { success: false, message: pickErrorMessage(result.parsed, `上游错误（${result.resp.status}）`) },
      result.resp.status,
    );
  }
  return json(
    { success: false, message: '上游返回了非预期响应，可能不是 sub2api 实例' },
    502,
  );
}

async function queryViaNewApi(backend, key, signal) {
  const target = buildUsageUrl(backend);
  if (!target) {
    return json({ success: false, message: '查询站点无效，请刷新页面后重试' }, 400);
  }

  const primary = await fetchJson(target, key, signal);

  if (primary.resp.status === 401) {
    return json(
      { success: false, message: pickErrorMessage(primary.parsed, '密钥无效或已删除') },
      401,
    );
  }
  if (primary.resp.ok && primary.parsed) {
    return json(primary.parsed);
  }

  // 主路被 WAF 挡（200 + HTML 质询）或返回 404：尝试 OpenAI 兼容回退。
  const shouldFallback = primary.resp.status === 404
    || (primary.resp.ok && !primary.parsed && looksLikeChallenge(primary.text));
  if (shouldFallback) {
    const fallback = await queryViaBillingFallback(backend, key, signal);
    if (fallback.kind === 'ok') return json(fallback.data);
    return json({ success: false, message: fallback.message }, fallback.status);
  }

  if (!primary.resp.ok) {
    return json(
      { success: false, message: pickErrorMessage(primary.parsed, `上游错误（${primary.resp.status}）`) },
      primary.resp.status,
    );
  }

  return json(
    { success: false, message: '上游返回了非预期响应，可能不是 new-api 实例' },
    502,
  );
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) {
    return json({ success: false, message: '请求体必须是 JSON' }, 400);
  }

  const siteId = String(body?.siteId || '').trim();
  let backend = null;
  let siteType = normalizeSiteType(body?.type);
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
      siteType = normalizeSiteType(site.type);
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    if (siteType === 'sub2api') {
      return await queryViaSub2Api(backend, key, ctrl.signal);
    }
    return await queryViaNewApi(backend, key, ctrl.signal);
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
