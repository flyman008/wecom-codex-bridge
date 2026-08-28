import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../dist/src/config.js';
import { VolcanoSemanticRouter } from '../dist/src/semantic-router.js';

const envPath = resolve('.env');
if (!existsSync(envPath)) throw new Error('未找到 .env');
process.loadEnvFile(envPath);

const config = loadConfig();
const router = new VolcanoSemanticRouter(config.llm);
const signal = new AbortController().signal;
const documentRoute = await router.decide(
  {
    text: '把这个文件生成企微普通在线文档',
    attachment: { fileName: 'example.html', extension: '.html', sizeBytes: 1024 },
  },
  signal,
);
const generalRoute = await router.decide(
  {
    text: '帮我总结今天的工作',
  },
  signal,
);
const offTopicRoute = await router.decide(
  {
    text: '给我讲个和工作无关的娱乐八卦',
  },
  signal,
);
const rememberRoute = await router.decide(
  {
    text: '请记住：我喜欢简洁直接的回复。',
  },
  signal,
);

if (documentRoute.intent !== 'file_to_wecom') {
  throw new Error('文档转换意图未被识别');
}
if (generalRoute.intent !== 'general') {
  throw new Error('普通任务被错误路由到 Codex');
}
if (!documentRoute.workRelated || !generalRoute.workRelated || offTopicRoute.workRelated) {
  throw new Error('工作相关性判断不符合预期');
}
if (rememberRoute.memoryAction !== 'remember' || !rememberRoute.memoryNote) {
  throw new Error('明确记忆要求未被识别');
}

console.log(
  JSON.stringify({
    ok: true,
    documentIntent: documentRoute.intent,
    documentConfidence: documentRoute.confidence,
    generalIntent: generalRoute.intent,
    generalConfidence: generalRoute.confidence,
    offTopicWorkRelated: offTopicRoute.workRelated,
    rememberAction: rememberRoute.memoryAction,
  }),
);
