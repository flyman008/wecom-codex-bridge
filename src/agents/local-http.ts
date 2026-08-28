import { createHash } from 'node:crypto';

import type { AppConfig } from '../config.js';
import type { AgentAdapter, AgentEvent, AgentName, AgentRequest } from '../types.js';
import { extractText, readSseData } from './sse.js';

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export class LocalHttpAgent implements AgentAdapter {
  readonly name: AgentName = 'local';

  constructor(private readonly config: AppConfig['localAgent']) {}

  isAvailable(): boolean {
    if (!this.config.url) return false;
    try {
      const url = new URL(this.config.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return this.config.allowRemote || isLoopback(url.hostname);
    } catch {
      return false;
    }
  }

  unavailableReason(): string {
    if (!this.config.url) return '本地处理服务还没准备好。';
    return '本地处理服务暂时连不上，稍后再试吧。';
  }

  async *run(request: AgentRequest): AsyncGenerator<AgentEvent, void> {
    if (!this.isAvailable()) throw new Error(this.unavailableReason());

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.config.timeoutMs)]);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;

    const response = await fetch(this.config.url as string, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: request.prompt,
        quotedContext: request.quotedContext,
        personaPrompt: request.personaPrompt,
        memoryContext: request.memoryContext,
        session: createHash('sha256').update(request.sessionKey).digest('hex'),
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 1_000);
      throw new Error(`本地 Agent 请求失败（${response.status}）：${body}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      for await (const data of readSseData(response)) {
        if (data === '[DONE]') return;
        let parsed: unknown = data;
        try {
          parsed = JSON.parse(data);
        } catch {
          // 允许本地 Agent 直接发送纯文本 data 行。
        }
        const text = extractText(parsed);
        if (text) yield { kind: 'delta', text };
      }
      return;
    }

    const data: unknown = await response.json();
    const text = extractText(data);
    if (!text) throw new Error('本地 Agent 未返回可识别的文本内容');
    yield { kind: 'replace', text };
  }
}
