import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUsageUrl, isAllowedBackend } from '../functions/api/query.js';

test('buildUsageUrl 会把查询接口拼到站点路径前缀后面', () => {
  assert.equal(
    buildUsageUrl('https://example.com/new-api/proxy'),
    'https://example.com/new-api/proxy/api/usage/token',
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
