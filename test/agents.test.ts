import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { LocalHttpAgent } from '../src/agents/local-http.js';
import { OpenAiCompatibleAgent } from '../src/agents/openai-compatible.js';
import type { AgentAdapter } from '../src/types.js';

async function collect(agent: AgentAdapter): Promise<string> {
  const output: string[] = [];
  for await (const event of agent.run({
    prompt: '测试',
    quotedContext: undefined,
    sessionKey: 'session',
    signal: new AbortController().signal,
  })) {
    if (event.kind === 'delta') output.push(event.text);
    if (event.kind === 'replace') return event.text;
  }
  return output.join('');
}

test('模型适配器可以解析 OpenAI 兼容 SSE', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
    response.end('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const agent = new OpenAiCompatibleAgent({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: 'test-key',
      model: 'test-model',
      systemPrompt: 'test',
      timeoutMs: 5_000,
    });
    assert.equal(await collect(agent), '你好');
    assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
    assert.equal(requestBody?.max_tokens, 1_024);
  } finally {
    server.close();
  }
});

test('本地 Agent 适配器可以解析 JSON 结果', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ text: '本地结果' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const agent = new LocalHttpAgent({
      url: `http://127.0.0.1:${address.port}/agent`,
      token: undefined,
      timeoutMs: 5_000,
      allowRemote: false,
    });
    assert.equal(await collect(agent), '本地结果');
  } finally {
    server.close();
  }
});
