import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBackend, normalizeSiteType, validateSiteInput } from '../functions/_lib/site-store.js';

test('normalizeBackend 保留站点路径前缀，只去掉结尾斜杠', () => {
  assert.equal(
    normalizeBackend('https://example.com/new-api/proxy/'),
    'https://example.com/new-api/proxy',
  );
});

test('validateSiteInput 保存后台站点时保留路径前缀', () => {
  const result = validateSiteInput({
    label: '主站',
    url: 'https://example.com/new-api/proxy/',
  });

  assert.deepEqual(result, {
    value: {
      label: '主站',
      url: 'https://example.com/new-api/proxy',
      type: 'new-api',
      enabled: true,
    },
  });
});

test('validateSiteInput 支持保存 sub2api 站点类型', () => {
  const result = validateSiteInput({
    label: 'Sub2API',
    url: 'https://sub.example.com/',
    type: 'sub2api',
  });

  assert.deepEqual(result, {
    value: {
      label: 'Sub2API',
      url: 'https://sub.example.com',
      type: 'sub2api',
      enabled: true,
    },
  });
});

test('normalizeSiteType 遇到旧配置或未知类型时默认按 new-api 处理', () => {
  assert.equal(normalizeSiteType(''), 'new-api');
  assert.equal(normalizeSiteType('unknown'), 'new-api');
  assert.equal(normalizeSiteType('Sub2API'), 'sub2api');
});
