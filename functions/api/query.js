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
//
// 一致性说明：
// - 主路始终是「令牌级」额度，是可信源；回退可能变成用户级额度，且 hard_limit_usd
//   在站点开启 CNY 展示时实际是人民币数值。
// - 因此：主路失败时先短重试一次；回退结果强制带 source=billing-fallback 供前端提示；
//   可选环境变量 BILLING_DISPLAY_CURRENCY=CNY + BILLING_USD_CNY_RATE 修正回退单位。

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
// new-api 对无限额度令牌在 Billing 接口里写死的占位金额。
const UNLIMITED_HARD_LIMIT_USD = 100000000;
// 主路被 WAF 挡时的重试间隔（毫秒）。
const PRIMARY_RETRY_DELAY_MS = 250;

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

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function getSub2ApiPayload(parsed) {
  if (parsed?.data && typeof parsed.data === 'object' && !parsed.mode) {
    return parsed.data;
  }
  return parsed || {};
}

/** 解析站点 Billing 回退的货币语义（new-api 在 CNY 展示下 hard_limit_usd 实际是人民币）。 */
export function parseBillingDisplayConfig(env) {
  const display = String(env?.BILLING_DISPLAY_CURRENCY || env?.UPSTREAM_QUOTA_DISPLAY || 'USD')
    .trim()
    .toUpperCase();
  const rate = numberOrNull(env?.BILLING_USD_CNY_RATE || env?.USD_CNY_RATE) ?? 0;
  return {
    display: display === 'CNY' ? 'CNY' : 'USD',
    usdCnyRate: rate > 0 ? rate : 0,
  };
}

/** 把 Billing 接口里的“展示金额”换算成真正的美元。 */
export function billingAmountToUsd(amount, displayConfig) {
  const n = numberOrNull(amount) ?? 0;
  if (n <= 0) return 0;
  if (displayConfig?.display === 'CNY' && displayConfig.usdCnyRate > 0) {
    return n / displayConfig.usdCnyRate;
  }
  return n;
}

/**
 * 订阅窗口选择：
 * 1) 优先 remaining 与 payload.remaining 精确匹配
 * 2) 否则按 monthly → weekly → daily（更接近用户理解的「余额」）
 * 避免旧逻辑「永远取最小 remaining」导致 50/53 跳动。
 */
export function pickSubscriptionWindow(subscription, fallbackRemaining) {
  if (!subscription || typeof subscription !== 'object') return null;

  const ordered = [
    {
      key: 'monthly',
      limit: numberOrNull(subscription.monthly_limit_usd),
      used: numberOrNull(subscription.monthly_usage_usd) ?? 0,
    },
    {
      key: 'weekly',
      limit: numberOrNull(subscription.weekly_limit_usd),
      used: numberOrNull(subscription.weekly_usage_usd) ?? 0,
    },
    {
      key: 'daily',
      limit: numberOrNull(subscription.daily_limit_usd),
      used: numberOrNull(subscription.daily_usage_usd) ?? 0,
    },
  ]
    .filter(item => item.limit !== null && item.limit > 0)
    .map(item => ({
      ...item,
      remaining: Math.max(0, item.limit - item.used),
    }));

  if (!ordered.length) return null;

  const target = numberOrNull(fallbackRemaining);
  if (target !== null) {
    const matched = ordered.find(item => Math.abs(item.remaining - target) < 0.000001);
    if (matched) return matched;
  }
  return ordered[0];
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

function extractTokenUsageData(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  // 标准 new-api：{ code/success, data: { total_available, ... } }
  const nested = parsed.data;
  if (nested && typeof nested === 'object') {
    if (
      nested.total_available !== undefined
      || nested.total_granted !== undefined
      || nested.object === 'token_usage'
      || nested.object === 'credit_summary'
    ) {
      return nested;
    }
  }

  // 少数网关直接扁平返回
  if (
    parsed.total_available !== undefined
    || parsed.total_granted !== undefined
    || parsed.object === 'token_usage'
  ) {
    return parsed;
  }

  return null;
}

/** 把 /api/usage/token/ 响应归一成前端统一结构（quota 原单位，不二次换算）。 */
export function normalizeNewApiUsageResponse(parsed) {
  if (parsed?.success === false) {
    return {
      success: false,
      message: pickErrorMessage(parsed, '查询失败'),
    };
  }

  const raw = extractTokenUsageData(parsed);
  if (!raw) return null;

  const used = numberOrNull(raw.total_used) ?? 0;
  const available = numberOrNull(raw.total_available);
  const grantedRaw = numberOrNull(raw.total_granted);
  const unlimited = !!raw.unlimited_quota;

  // 以 remaining 为准：未使用密钥 total_granted 应等于 remain+used。
  // 若上游偶发只给了 remain 当 total_granted，这里用 available+used 纠正展示。
  let availableQuota = available;
  if (availableQuota === null) {
    availableQuota = grantedRaw !== null ? Math.max(0, grantedRaw - used) : 0;
  }
  let grantedQuota = grantedRaw;
  if (grantedQuota === null || (!unlimited && grantedQuota < availableQuota + used)) {
    grantedQuota = unlimited ? 0 : availableQuota + used;
  }

  return {
    success: true,
    data: {
      name: raw.name || '令牌',
      unlimited_quota: unlimited,
      total_granted: grantedQuota,
      total_used: used,
      total_available: availableQuota,
      expires_at: toUnixSeconds(raw.expires_at),
      model_limits_enabled: !!raw.model_limits_enabled,
      model_limits: raw.model_limits && typeof raw.model_limits === 'object' ? raw.model_limits : {},
      provider: 'new-api',
      source: 'token-usage',
    },
  };
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
      source: 'sub2api',
      status: payload?.status || '',
      mode: payload?.mode || '',
    },
  };
}

/** 从 Billing 双接口合成统一额度结构。 */
export function normalizeBillingSubscription(subParsed, usageParsed, displayConfig = { display: 'USD', usdCnyRate: 0 }) {
  const hardLimitRaw = numberOrNull(subParsed?.hard_limit_usd ?? subParsed?.soft_limit_usd) ?? 0;
  const unlimited = !!subParsed?.unlimited_quota || hardLimitRaw >= UNLIMITED_HARD_LIMIT_USD;
  const expiresAt = numberOrNull(subParsed?.access_until) ?? 0;

  const usageCents = numberOrNull(usageParsed?.total_usage);
  const usedDisplay = usageCents === null ? 0 : usageCents / CENTS_PER_USD;

  const totalUsd = unlimited ? 0 : billingAmountToUsd(hardLimitRaw, displayConfig);
  const usedUsd = unlimited ? 0 : billingAmountToUsd(usedDisplay, displayConfig);
  const availableUsd = unlimited ? 0 : Math.max(0, totalUsd - usedUsd);

  return {
    success: true,
    data: {
      name: subParsed?.plan?.title || '订阅令牌',
      unlimited_quota: unlimited,
      total_granted: usdToQuota(totalUsd),
      total_used: usdToQuota(usedUsd),
      total_available: usdToQuota(availableUsd),
      expires_at: toUnixSeconds(expiresAt),
      model_limits_enabled: false,
      model_limits: {},
      provider: 'new-api',
      source: 'billing-fallback',
    },
  };
}

// 回退：走 OpenAI Billing 兼容接口合成出前端期望的字段结构。
async function queryViaBillingFallback(backend, key, signal, displayConfig) {
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

  return {
    kind: 'ok',
    data: normalizeBillingSubscription(
      sub.parsed,
      usage.resp.ok ? usage.parsed : null,
      displayConfig,
    ),
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

function shouldTryBillingFallback(result) {
  if (!result) return false;
  if (result.resp.status === 404) return true;
  return result.resp.ok && !result.parsed && looksLikeChallenge(result.text);
}

async function queryViaNewApi(backend, key, signal, displayConfig) {
  const target = buildUsageUrl(backend);
  if (!target) {
    return json({ success: false, message: '查询站点无效，请刷新页面后重试' }, 400);
  }

  let primary = await fetchJson(target, key, signal);

  if (primary.resp.status === 401) {
    return json(
      { success: false, message: pickErrorMessage(primary.parsed, '密钥无效或已删除') },
      401,
    );
  }

  if (primary.resp.ok && primary.parsed) {
    const normalized = normalizeNewApiUsageResponse(primary.parsed);
    if (normalized?.success) return json(normalized);
    if (normalized && normalized.success === false) {
      return json(normalized, 403);
    }
    // JSON 能解析但不是额度结构：继续尝试回退，避免空白结果。
  }

  // 主路被 WAF 挡（200 + HTML 质询）或 404：短延迟后重试一次主路（令牌级更准）。
  if (shouldTryBillingFallback(primary) || (primary.resp.ok && primary.parsed && !normalizeNewApiUsageResponse(primary.parsed))) {
    try {
      await sleep(PRIMARY_RETRY_DELAY_MS, signal);
      const retry = await fetchJson(target, key, signal);
      if (retry.resp.status === 401) {
        return json(
          { success: false, message: pickErrorMessage(retry.parsed, '密钥无效或已删除') },
          401,
        );
      }
      if (retry.resp.ok && retry.parsed) {
        const normalized = normalizeNewApiUsageResponse(retry.parsed);
        if (normalized?.success) return json(normalized);
      }
      primary = retry;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // 重试失败则沿用第一次结果进入回退判断
    }
  }

  if (shouldTryBillingFallback(primary) || (primary.resp.ok && primary.parsed && !normalizeNewApiUsageResponse(primary.parsed))) {
    const fallback = await queryViaBillingFallback(backend, key, signal, displayConfig);
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

  const displayConfig = parseBillingDisplayConfig(env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    if (siteType === 'sub2api') {
      return await queryViaSub2Api(backend, key, ctrl.signal);
    }
    return await queryViaNewApi(backend, key, ctrl.signal, displayConfig);
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
