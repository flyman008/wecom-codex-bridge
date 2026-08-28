import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve('.env');
if (!existsSync(envPath)) throw new Error('未找到 .env');
process.loadEnvFile(envPath);

const baseUrl = process.env.LLM_BASE_URL?.trim();
const apiKey = process.env.LLM_API_KEY?.trim();
const model = process.env.LLM_MODEL?.trim();
if (!baseUrl || !apiKey || !model) throw new Error('模型配置不完整');

const endpoint = baseUrl.endsWith('/chat/completions')
  ? baseUrl
  : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    stream: false,
    max_tokens: 16,
    messages: [{ role: 'user', content: '只回复：连接成功' }],
  }),
  signal: AbortSignal.timeout(60_000),
});

if (!response.ok) {
  throw new Error(`模型连通性验证失败（HTTP ${response.status}）`);
}

const payload = await response.json();
const content = payload?.choices?.[0]?.message?.content;
if (typeof content !== 'string' || !content.trim()) {
  throw new Error('模型接口已响应，但没有返回可识别的文本');
}

console.log(JSON.stringify({ ok: true, model, preview: content.trim().slice(0, 40) }));
