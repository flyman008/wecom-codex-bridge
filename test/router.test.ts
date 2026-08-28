import assert from 'node:assert/strict';
import test from 'node:test';

import { decideRoute, normalizeIncomingText } from '../src/router.js';

test('群聊文本会移除开头的机器人提及', () => {
  assert.equal(normalizeIncomingText('@机器人A   /codex 修复测试', true), '/codex 修复测试');
});

test('单聊文本不会移除普通内容', () => {
  assert.equal(normalizeIncomingText('  hello  ', false), 'hello');
});

test('通用 Codex 指令被拒绝', () => {
  const result = decideRoute('/codex 修复构建', 'llm');
  assert.equal(result.agent, undefined);
  assert.match(result.directReply ?? '', /指令不用/);
});

test('无指令时要求进行语义路由', () => {
  assert.deepEqual(decideRoute('总结今天的工作', 'local'), {
    prompt: '总结今天的工作',
    requiresSemanticRouting: true,
  });
});

test('缺少任务内容时直接返回帮助', () => {
  const result = decideRoute('/ask', 'llm');
  assert.equal(result.agent, undefined);
  assert.match(result.directReply ?? '', /写上/);
});
