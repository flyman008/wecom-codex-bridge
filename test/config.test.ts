import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig, parseDirectoryList } from '../src/config.js';

test('parseDirectoryList parses Windows roots and removes duplicates', () => {
  assert.deepEqual(parseDirectoryList('C:\\; D:\\;C:\\'), ['C:\\', 'D:\\']);
});

test('parseDirectoryList handles empty values', () => {
  assert.deepEqual(parseDirectoryList(undefined), []);
  assert.deepEqual(parseDirectoryList(' ; '), []);
});

test('读取 Codex 首选模型和额度降级模型', () => {
  const config = loadConfig({
    WECOM_BOT_ID: 'bot',
    WECOM_BOT_SECRET: 'secret',
    CODEX_MODEL: 'gpt-5.3-codex-spark',
    CODEX_FALLBACK_MODEL: 'gpt-5.4-mini',
    CODEX_REASONING_EFFORT: 'low',
    CODEX_SERVICE_TIER: 'fast',
  });
  assert.equal(config.codex.model, 'gpt-5.3-codex-spark');
  assert.equal(config.codex.fallbackModel, 'gpt-5.4-mini');
  assert.equal(config.codex.reasoningEffort, 'low');
  assert.equal(config.codex.serviceTier, 'fast');
  assert.equal(config.codex.transientRetries, 2);
});
