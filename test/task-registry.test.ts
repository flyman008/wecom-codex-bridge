import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskRegistry } from '../src/task-registry.js';

test('重复消息不会启动第二次任务', () => {
  const registry = new TaskRegistry(3);
  assert.equal(registry.begin('message-1', 'actor-1', 1_000), 'started');
  assert.equal(registry.begin('message-1', 'actor-1', 1_001), 'duplicate');
});

test('同一发送人最多运行配置数量的任务', () => {
  const registry = new TaskRegistry(2);
  assert.equal(registry.begin('message-1', 'actor-1'), 'started');
  assert.equal(registry.begin('message-2', 'actor-1'), 'started');
  assert.equal(registry.begin('message-3', 'actor-1'), 'busy');
  registry.finish('actor-1');
  assert.equal(registry.begin('message-4', 'actor-1'), 'started');
});

test('不同发送人的并发额度相互隔离', () => {
  const registry = new TaskRegistry(1);
  assert.equal(registry.begin('message-1', 'actor-1'), 'started');
  assert.equal(registry.begin('message-2', 'actor-2'), 'started');
  assert.equal(registry.activeTasks, 2);
});
