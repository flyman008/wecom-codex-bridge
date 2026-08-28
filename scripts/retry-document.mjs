import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

import { CodexCliAgent } from '../dist/src/agents/codex-cli.js';
import { loadConfig } from '../dist/src/config.js';
import { conversionOperationFor } from '../dist/src/conversion-policy.js';

process.loadEnvFile(resolve('.env'));
const source = process.argv[2];
if (!source) throw new Error('请提供源文件路径');
const filePath = resolve(source);
const fileStats = await stat(filePath);
const config = loadConfig();
const agent = new CodexCliAgent(config.codex);
let finalText = '';

for await (const event of agent.run({
  prompt: '把这个文件生成企微普通在线文档，保留字段和数据表格。',
  quotedContext: undefined,
  sessionKey: 'manual-retry',
  signal: new AbortController().signal,
  operation: conversionOperationFor({ extension: extname(filePath).toLowerCase() }),
  attachments: [
    {
      filePath,
      fileName: basename(filePath),
      extension: extname(filePath).toLowerCase(),
      sizeBytes: fileStats.size,
    },
  ],
})) {
  if (event.kind === 'status') process.stderr.write(`${event.text}\n`);
  if (event.kind === 'replace') finalText = event.text;
  if (event.kind === 'delta') finalText += event.text;
}

if (!finalText) throw new Error('没有得到文档结果');
process.stdout.write(`${finalText}\n`);
