import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  canDispatchFileToCodex,
  parseSemanticRoute,
  VolcanoSemanticRouter,
} from '../src/semantic-router.js';

const attachment = {
  filePath: 'D:\\task\\report.pdf',
  fileName: 'report.pdf',
  extension: '.pdf',
  sizeBytes: 100,
};

test('语义路由只接受两个固定意图', () => {
  assert.deepEqual(
    parseSemanticRoute(
      '{"intent":"file_to_wecom","confidence":0.96,"work_related":true,"memory_action":"none","memory_note":""}',
    ),
    {
      intent: 'file_to_wecom',
      confidence: 0.96,
      workRelated: true,
      memoryAction: 'none',
      memoryNote: undefined,
    },
  );
  assert.throws(
    () =>
      parseSemanticRoute(
        '{"intent":"run_codex","confidence":1,"work_related":true,"memory_action":"none","memory_note":""}',
      ),
    /未允许/,
  );
  assert.throws(
    () =>
      parseSemanticRoute(
        '{"intent":"general","confidence":1,"memory_action":"none","memory_note":""}',
      ),
    /work_related/,
  );
  assert.deepEqual(
    parseSemanticRoute(
      '{"intent":"general","confidence":0.9,"work_related":true,"memory_action":"remember","memory_note":"用户喜欢简洁回复"}',
    ).memoryAction,
    'remember',
  );
});

test('只有文档意图、足够置信度且有附件时才能调度 Codex', () => {
  assert.equal(
    canDispatchFileToCodex(
      { intent: 'file_to_wecom', confidence: 0.95 },
      attachment,
      0.85,
    ),
    true,
  );
  assert.equal(
    canDispatchFileToCodex(
      { intent: 'general', confidence: 1 },
      attachment,
      0.85,
    ),
    false,
  );
  assert.equal(
    canDispatchFileToCodex(
      { intent: 'file_to_wecom', confidence: 0.7 },
      attachment,
      0.85,
    ),
    false,
  );
  assert.equal(
    canDispatchFileToCodex(
      { intent: 'file_to_wecom', confidence: 1 },
      undefined,
      0.85,
    ),
    false,
  );
});

test('语义路由关闭深度思考并限制 JSON 输出长度', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"intent":"general","confidence":1,"work_related":true,"memory_action":"none","memory_note":""}',
              },
            },
          ],
        }),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const router = new VolcanoSemanticRouter({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: 'test-key',
      model: 'test-model',
      systemPrompt: 'test',
      timeoutMs: 5_000,
    });
    await router.decide({ text: '测试' }, new AbortController().signal);
    assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
    assert.equal(requestBody?.max_tokens, 128);
  } finally {
    server.close();
  }
});
