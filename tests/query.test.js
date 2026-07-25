import test from 'node:test';
import assert from 'node:assert/strict';

import {
  billingAmountToUsd,
  buildSub2ApiUsageUrl,
  buildUsageUrl,
  isAllowedBackend,
  normalizeBillingSubscription,
  normalizeNewApiUsageResponse,
  normalizeSub2ApiUsageResponse,
  onRequestPost,
  parseBillingDisplayConfig,
  pickSubscriptionWindow,
} from '../functions/api/query.js';

test('buildUsageUrl 会把查询接口拼到站点路径前缀后面', () => {
  assert.equal(
    buildUsageUrl('https://example.com/new-api/proxy'),
    'https://example.com/new-api/proxy/api/usage/token/',
  );
});

test('buildSub2ApiUsageUrl 会把 sub2api 查询接口拼到站点路径前缀后面', () => {
  assert.equal(
    buildSub2ApiUsageUrl('https://example.com/sub2api/proxy'),
    'https://example.com/sub2api/proxy/v1/usage',
  );
});

test('ALLOWED_BACKENDS 只写域名时，允许同域名下带路径前缀的站点', () => {
  assert.equal(
    isAllowedBackend('https://example.com/new-api/proxy', ['https://example.com']),
    true,
  );
});

test('ALLOWED_BACKENDS 写了完整路径时，仍然要求精确匹配', () => {
  assert.equal(
    isAllowedBackend('https://example.com/new-api/proxy-b', ['https://example.com/new-api/proxy-a']),
    false,
  );
});

test('normalizeNewApiUsageResponse 会归一化令牌额度并标记 source', () => {
  const result = normalizeNewApiUsageResponse({
    code: true,
    message: 'ok',
    data: {
      object: 'token_usage',
      name: '测试令牌',
      total_granted: 25000000,
      total_used: 0,
      total_available: 25000000,
      unlimited_quota: false,
      expires_at: 0,
      model_limits_enabled: false,
      model_limits: {},
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.source, 'token-usage');
  assert.equal(result.data.provider, 'new-api');
  assert.equal(result.data.total_available, 25000000);
  assert.equal(result.data.name, '测试令牌');
});

test('normalizeNewApiUsageResponse 会用 remain+used 纠正偏小的 total_granted', () => {
  const result = normalizeNewApiUsageResponse({
    success: true,
    data: {
      total_granted: 10,
      total_used: 3,
      total_available: 50,
      unlimited_quota: false,
    },
  });

  assert.equal(result.data.total_available, 50);
  assert.equal(result.data.total_used, 3);
  assert.equal(result.data.total_granted, 53);
});

test('normalizeBillingSubscription 默认按 USD 换算并标记 billing-fallback', () => {
  const result = normalizeBillingSubscription(
    { hard_limit_usd: 50, access_until: 0 },
    { total_usage: 0 },
  );

  assert.equal(result.success, true);
  assert.equal(result.data.source, 'billing-fallback');
  assert.equal(result.data.total_available, 50 * 500000);
  assert.equal(result.data.total_used, 0);
});

test('normalizeBillingSubscription 在 CNY 展示配置下会先除汇率再换算', () => {
  const result = normalizeBillingSubscription(
    { hard_limit_usd: 50.4, access_until: 0 },
    { total_usage: 0 },
    { display: 'CNY', usdCnyRate: 7.2 },
  );

  // 50.4 CNY / 7.2 = 7 USD → 7 * 500000 quota
  assert.equal(result.data.total_available, 7 * 500000);
  assert.equal(result.data.source, 'billing-fallback');
});

test('billingAmountToUsd 与 parseBillingDisplayConfig 协作', () => {
  assert.deepEqual(parseBillingDisplayConfig({ BILLING_DISPLAY_CURRENCY: 'cny', BILLING_USD_CNY_RATE: '7.2' }), {
    display: 'CNY',
    usdCnyRate: 7.2,
  });
  assert.equal(billingAmountToUsd(72, { display: 'CNY', usdCnyRate: 7.2 }), 10);
  assert.equal(billingAmountToUsd(10, { display: 'USD', usdCnyRate: 0 }), 10);
});

test('pickSubscriptionWindow 在无精确匹配时优先 monthly 而不是最小 remaining', () => {
  const picked = pickSubscriptionWindow({
    daily_limit_usd: 10,
    daily_usage_usd: 0,
    weekly_limit_usd: 50,
    weekly_usage_usd: 0,
    monthly_limit_usd: 53,
    monthly_usage_usd: 0,
  }, null);

  assert.equal(picked.key, 'monthly');
  assert.equal(picked.remaining, 53);
});

test('pickSubscriptionWindow 会优先匹配 payload.remaining', () => {
  const picked = pickSubscriptionWindow({
    daily_limit_usd: 10,
    daily_usage_usd: 0,
    weekly_limit_usd: 50,
    weekly_usage_usd: 0,
    monthly_limit_usd: 53,
    monthly_usage_usd: 0,
  }, 50);

  assert.equal(picked.key, 'weekly');
  assert.equal(picked.remaining, 50);
});

test('normalizeSub2ApiUsageResponse 会转换 quota_limited 额度数据', () => {
  const expiresAt = '2026-05-05T00:00:00Z';
  const result = normalizeSub2ApiUsageResponse({
    mode: 'quota_limited',
    isValid: true,
    status: 'active',
    quota: {
      limit: 10,
      used: 3,
      remaining: 7,
      unit: 'USD',
    },
    expires_at: expiresAt,
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      name: 'Sub2API 密钥',
      unlimited_quota: false,
      total_granted: 5000000,
      total_used: 1500000,
      total_available: 3500000,
      expires_at: Math.floor(Date.parse(expiresAt) / 1000),
      model_limits_enabled: false,
      model_limits: {},
      provider: 'sub2api',
      source: 'sub2api',
      status: 'active',
      mode: 'quota_limited',
    },
  });
});

test('normalizeSub2ApiUsageResponse 会转换钱包余额模式数据', () => {
  const result = normalizeSub2ApiUsageResponse({
    mode: 'unrestricted',
    isValid: true,
    planName: '钱包余额',
    remaining: 8,
    balance: 8,
    usage: {
      total: {
        actual_cost: 2,
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.total_granted, 5000000);
  assert.equal(result.data.total_used, 1000000);
  assert.equal(result.data.total_available, 4000000);
  assert.equal(result.data.source, 'sub2api');
});

test('normalizeSub2ApiUsageResponse 会保留 sub2api 业务错误', () => {
  assert.deepEqual(
    normalizeSub2ApiUsageResponse({ success: false, message: '密钥不可用' }),
    { success: false, message: '密钥不可用' },
  );
});

test('/api/query 会按后台站点类型调用 sub2api /v1/usage', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedAuth = '';

  globalThis.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    requestedAuth = options.headers?.Authorization || '';
    return new Response(JSON.stringify({
      mode: 'quota_limited',
      isValid: true,
      status: 'active',
      quota: {
        limit: 5,
        used: 1,
        remaining: 4,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const request = new Request('https://query.example.com/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: 'sub-site', key: 'sk-test' }),
    });
    const env = {
      SITE_CONFIG: {
        get: async () => JSON.stringify([{
          id: 'sub-site',
          label: 'Sub2API',
          url: 'https://sub.example.com',
          type: 'sub2api',
          enabled: true,
        }]),
      },
    };

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(requestedUrl, 'https://sub.example.com/v1/usage');
    assert.equal(requestedAuth, 'Bearer sk-test');
    assert.equal(data.data.total_available, 2000000);
    assert.equal(data.data.source, 'sub2api');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/api/query new-api 主路成功时标记 token-usage 且不走 billing', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      code: true,
      message: 'ok',
      data: {
        object: 'token_usage',
        name: 'A',
        total_granted: 25000000,
        total_used: 0,
        total_available: 25000000,
        unlimited_quota: false,
        expires_at: 0,
        model_limits_enabled: false,
        model_limits: {},
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const request = new Request('https://query.example.com/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'https://api.example.com', key: 'sk-test' }),
    });
    const response = await onRequestPost({ request, env: {} });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.data.source, 'token-usage');
    assert.equal(data.data.total_available, 25000000);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/api\/usage\/token\/$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/api/query 主路 WAF 后回退 billing 并标记 billing-fallback', async () => {
  const originalFetch = globalThis.fetch;
  let usageHits = 0;

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/usage/token/')) {
      usageHits += 1;
      return new Response('<html><script>acw_sc__v2</script></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    if (u.includes('/billing/subscription')) {
      return new Response(JSON.stringify({
        hard_limit_usd: 50,
        access_until: 0,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('/billing/usage')) {
      return new Response(JSON.stringify({ total_usage: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const request = new Request('https://query.example.com/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'https://api.example.com', key: 'sk-test' }),
    });
    const response = await onRequestPost({ request, env: {} });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.data.source, 'billing-fallback');
    assert.equal(data.data.total_available, 50 * 500000);
    // 主路至少尝试 2 次（首次 + 重试）
    assert.ok(usageHits >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
