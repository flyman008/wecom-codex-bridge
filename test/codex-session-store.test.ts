import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CodexSessionStore } from '../src/codex-session-store.js';

test('Codex 会话映射持久化且不保存原始企微会话键', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-session-test-'));
  const path = join(root, 'sessions.json');
  const rawSessionKey = 'group:raw-chat-id:raw-user-id';
  const threadId = '01a047b0-19a4-7093-a833-b3ebf05baa3f';
  const store = await CodexSessionStore.open(path);
  await store.set(rawSessionKey, threadId);

  const reopened = await CodexSessionStore.open(path);
  assert.equal(reopened.get(rawSessionKey), threadId);
  assert.doesNotMatch(await readFile(path, 'utf8'), /raw-chat-id|raw-user-id/);
});
