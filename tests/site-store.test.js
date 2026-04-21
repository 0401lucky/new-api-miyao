import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBackend, validateSiteInput } from '../functions/_lib/site-store.js';

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
      enabled: true,
    },
  });
});
