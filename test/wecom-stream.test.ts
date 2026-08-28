import assert from 'node:assert/strict';
import test from 'node:test';

import type { WSClient, WsFrameHeaders } from '@wecom/aibot-node-sdk';

import { WeComStreamResponder } from '../src/wecom-stream.js';

interface Call {
  method: string;
  content: string;
  finish: boolean | undefined;
}

function fakeClient(calls: Call[]): WSClient {
  return {
    async replyStream(_frame: unknown, _stream: string, content: string, finish?: boolean) {
      calls.push({ method: 'stream', content, finish });
      return {};
    },
    async replyStreamNonBlocking(_frame: unknown, _stream: string, content: string, finish?: boolean) {
      calls.push({ method: 'stream-nonblocking', content, finish });
      return {};
    },
    async sendMessage(_target: string, body: { markdown: { content: string } }) {
      calls.push({ method: 'proactive', content: body.markdown.content, finish: undefined });
      return {};
    },
  } as unknown as WSClient;
}

test('流式回复累计内容并以最终帧结束', async () => {
  const calls: Call[] = [];
  const responder = new WeComStreamResponder(
    fakeClient(calls),
    { headers: { req_id: 'request' } } as WsFrameHeaders,
    'stream',
    { flushMs: 1, timeoutMs: 10_000 },
  );
  await responder.open('开始');
  await responder.update({ kind: 'delta', text: '你' });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await responder.update({ kind: 'delta', text: '好' });
  await responder.complete();

  assert.equal(calls.at(-1)?.finish, true);
  assert.equal(calls.at(-1)?.content, '你好');
});

test('流式超时后完成任务会改用主动通知', async () => {
  const calls: Call[] = [];
  const responder = new WeComStreamResponder(
    fakeClient(calls),
    { headers: { req_id: 'request' } } as WsFrameHeaders,
    'stream',
    { flushMs: 1, timeoutMs: 10, proactiveTarget: 'target' },
  );
  await responder.open('开始');
  await new Promise((resolve) => setTimeout(resolve, 20));
  await responder.update({ kind: 'replace', text: '后台任务完成' });
  await responder.complete();

  assert.equal(calls.at(-1)?.method, 'proactive');
  assert.equal(calls.at(-1)?.content, '后台任务完成');
});

test('需要用户处理的错误可以原样回复', async () => {
  const calls: Call[] = [];
  const responder = new WeComStreamResponder(
    fakeClient(calls),
    { headers: { req_id: 'request' } } as WsFrameHeaders,
    'stream',
    { flushMs: 1, timeoutMs: 10_000 },
  );
  await responder.open('开始');
  await responder.fail('请完成授权', true);
  assert.equal(calls.at(-1)?.content, '请完成授权');
});
