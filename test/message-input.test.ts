import assert from 'node:assert/strict';
import test from 'node:test';

import { isHelpRequest, normalizeIncomingText } from '../src/message-input.js';

test('群聊文本会移除开头的机器人提及', () => {
  assert.equal(normalizeIncomingText('@机器人A   修复测试', true), '修复测试');
});

test('单聊文本不会移除普通内容', () => {
  assert.equal(normalizeIncomingText('  hello  ', false), 'hello');
});

test('空消息和 help 指令返回帮助', () => {
  assert.equal(isHelpRequest(''), true);
  assert.equal(isHelpRequest('/help'), true);
  assert.equal(isHelpRequest('总结今天的工作'), false);
});
