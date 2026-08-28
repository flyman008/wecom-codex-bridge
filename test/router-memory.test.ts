import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RouterAgent } from '../src/router-agent.js';
import { RouterMemoryStore } from '../src/router-memory.js';
import type { VolcanoSemanticRouter } from '../src/semantic-router.js';

const limits = {
  recentTurnsPerSession: 4,
  maxTurnCharacters: 100,
  maxUserFacts: 3,
  maxFactCharacters: 80,
};

test('Memory 会持久化并隔离同一人的不同群会话', async () => {
  const root = await mkdtemp(join(tmpdir(), 'router-memory-test-'));
  const path = join(root, 'memory.json');
  try {
    const first = await RouterMemoryStore.open(path, limits);
    await first.remember('hashed-user', '用户喜欢简洁回复');
    await first.observeWorkRelated('hashed-user', false);
    await first.observeWorkRelated('hashed-user', false);
    await first.recordUserTurn('hashed-user', 'group-a-user', 'group', '群 A 的问题');
    await first.recordUserTurn('hashed-user', 'group-b-user', 'group', '群 B 的问题');

    const restarted = await RouterMemoryStore.open(path, limits);
    assert.deepEqual(restarted.snapshot('hashed-user', 'group-a-user').facts, [
      '用户喜欢简洁回复',
    ]);
    assert.equal(restarted.snapshot('hashed-user', 'group-a-user').consecutiveOffTopic, 2);
    assert.equal(restarted.snapshot('hashed-user', 'group-a-user').recentTurns[0]?.content, '群 A 的问题');
    assert.equal(restarted.snapshot('hashed-user', 'group-b-user').recentTurns[0]?.content, '群 B 的问题');

    await restarted.forgetUser('hashed-user');
    const forgotten = await RouterMemoryStore.open(path, limits);
    assert.deepEqual(forgotten.snapshot('hashed-user', 'group-a-user').facts, []);
    assert.deepEqual(forgotten.snapshot('hashed-user', 'group-a-user').recentTurns, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('总管 Agent 只持久化加密散列键，并把个人记忆带入后续路由', async () => {
  const root = await mkdtemp(join(tmpdir(), 'router-agent-test-'));
  const profilePath = join(root, 'profile.json');
  const memoryPath = join(root, 'memory.json');
  const profile = {
    version: 1,
    name: '测试总管',
    personaPrompt: '温和简洁',
    offTopicReminder: 'go back to work',
    offTopicReminderThreshold: 3,
    memory: limits,
  };
  await writeFile(profilePath, JSON.stringify(profile), 'utf8');

  let receivedMemory: string | undefined;
  let call = 0;
  const fakeRouter = {
    async decide(input: { memoryContext?: string }) {
      receivedMemory = input.memoryContext;
      call += 1;
      return call === 1
        ? {
            intent: 'general' as const,
            confidence: 0.99,
            workRelated: true,
            memoryAction: 'remember' as const,
            memoryNote: '用户喜欢简洁回复',
          }
        : {
            intent: 'general' as const,
            confidence: 0.99,
            workRelated: true,
            memoryAction: 'none' as const,
            memoryNote: undefined,
          };
    },
  } as unknown as VolcanoSemanticRouter;

  try {
    const agent = await RouterAgent.create(
      { profilePath, memoryPath },
      fakeRouter,
      'test-secret',
    );
    const input = {
      actorKey: 'raw-user-identifier',
      sessionKey: 'group:raw-chat-identifier:raw-user-identifier',
      scope: 'group' as const,
      text: '记住我喜欢简洁回复',
    };
    await agent.decide(input, new AbortController().signal);
    await agent.decide({ ...input, text: '继续' }, new AbortController().signal);

    assert.match(receivedMemory ?? '', /用户喜欢简洁回复/);
    const persisted = await readFile(memoryPath, 'utf8');
    assert.doesNotMatch(persisted, /raw-user-identifier|raw-chat-identifier/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('人设可以关闭连续偏题提醒', async () => {
  const root = await mkdtemp(join(tmpdir(), 'router-agent-profile-test-'));
  const profilePath = join(root, 'profile.json');
  const memoryPath = join(root, 'memory.json');
  await writeFile(
    profilePath,
    JSON.stringify({
      version: 1,
      name: '中性助手',
      personaPrompt: '准确回答。',
      offTopicReminder: '',
      offTopicReminderThreshold: 0,
      memory: limits,
    }),
    'utf8',
  );
  const fakeRouter = {
    async decide() {
      return {
        intent: 'general' as const,
        confidence: 0.99,
        workRelated: false,
        memoryAction: 'none' as const,
        memoryNote: undefined,
      };
    },
  } as unknown as VolcanoSemanticRouter;

  try {
    const agent = await RouterAgent.create(
      { profilePath, memoryPath },
      fakeRouter,
      'test-secret',
    );
    const result = await agent.decide(
      {
        actorKey: 'user',
        sessionKey: 'session',
        scope: 'single',
        text: '闲聊',
      },
      new AbortController().signal,
    );
    assert.equal(result.focusReminder, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
