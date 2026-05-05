import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSub2ApiUsageUrl,
  buildUsageUrl,
  isAllowedBackend,
  normalizeSub2ApiUsageResponse,
  onRequestPost,
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
