import assert from 'node:assert/strict';
import test from 'node:test';

import { extractText, readSseData } from '../src/agents/sse.js';

test('可以读取分块 SSE 数据', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"text":"你'));
      controller.enqueue(new TextEncoder().encode('好"}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });
  const response = new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  const data: string[] = [];
  for await (const item of readSseData(response)) data.push(item);
  assert.deepEqual(data, ['{"text":"你好"}', '[DONE]']);
});

test('可以提取 OpenAI 兼容增量文本', () => {
  assert.equal(extractText({ choices: [{ delta: { content: '片段' } }] }), '片段');
});
