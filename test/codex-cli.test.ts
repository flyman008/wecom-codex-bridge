import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import {
  buildCodexConfigArgs,
  buildCodexGeneralPrompt,
  buildCodexRetryPrompt,
  buildDocumentConversionPrompt,
  changedGeneratedImagePaths,
  codexModelCandidates,
  extractCodexImagePath,
  extractWeComDocumentResult,
  extractWeComSpreadsheetResult,
  isCodexCapacityError,
  isCodexTransientError,
  resolveCodexCommand,
  resolveWeComCliInvocation,
  resolveWeComCliScript,
} from '../src/agents/codex-cli.js';

test('Spark 使用轻度推理和自身极速通道', () => {
  assert.deepEqual(buildCodexConfigArgs('low', 'fast', 'gpt-5.3-codex-spark'), [
    '--config',
    'model_reasoning_effort="low"',
  ]);
});

test('5.4 Mini 使用轻度推理且不发送当前不支持的 Fast 档位', () => {
  assert.deepEqual(buildCodexConfigArgs('low', 'fast', 'gpt-5.4-mini'), [
    '--config',
    'model_reasoning_effort="low"',
  ]);
});

test('支持 Fast mode 的模型会显式启用快速服务档位', () => {
  assert.deepEqual(buildCodexConfigArgs('low', 'fast', 'gpt-5.4'), [
    '--config',
    'model_reasoning_effort="low"',
    '--config',
    'service_tier="fast"',
    '--config',
    'features.fast_mode=true',
  ]);
});

test('Codex 模型链首选 Spark、降级到 5.4 Mini', () => {
  assert.deepEqual(codexModelCandidates('gpt-5.3-codex-spark', 'gpt-5.4-mini'), [
    'gpt-5.3-codex-spark',
    'gpt-5.4-mini',
  ]);
  assert.deepEqual(codexModelCandidates('same', 'same'), ['same']);
  assert.deepEqual(codexModelCandidates(undefined, undefined), [undefined]);
});

test('只有额度、配额或限流错误触发 Codex 模型降级', () => {
  assert.equal(isCodexCapacityError(new Error("You've hit your usage limit")), true);
  assert.equal(isCodexCapacityError(new Error('insufficient_quota')), true);
  assert.equal(isCodexCapacityError(new Error('当前模型额度已用完')), true);
  assert.equal(isCodexCapacityError(new Error('network connection closed')), false);
  assert.equal(isCodexCapacityError(new Error('tool execution failed')), false);
});

test('Codex 上游临时断流会被识别为可重试错误', () => {
  assert.equal(
    isCodexTransientError(
      new Error(
        'stream disconnected before completion: websocket closed by server before response.completed',
      ),
    ),
    true,
  );
  assert.equal(isCodexTransientError(new Error('read ECONNRESET')), true);
  assert.equal(isCodexTransientError(new Error('network connection closed')), true);
  assert.equal(isCodexTransientError(new Error('setup refresh had errors')), false);
  assert.equal(isCodexTransientError(new Error('tool execution failed')), false);
  assert.equal(isCodexTransientError(new Error('insufficient_quota')), false);
});

test('Codex 重试提示要求续跑且避免重复外部写入', () => {
  const prompt = buildCodexRetryPrompt('创建一份企微文档');
  assert.match(prompt, /连接中断/);
  assert.match(prompt, /不要重复创建/);
  assert.match(prompt, /创建一份企微文档/);
});

test('Codex 普通对话提示支持人设和附件', () => {
  const prompt = buildCodexGeneralPrompt({
    prompt: '总结一下这个文件',
    quotedContext: '补充说明',
    personaPrompt: '暖男型工作搭档',
    sessionKey: 'session',
    signal: new AbortController().signal,
    attachments: [
      {
        filePath: 'D:\\task\\report.pdf',
        fileName: 'report.pdf',
        extension: '.pdf',
        sizeBytes: 100,
      },
    ],
  });
  assert.match(prompt, /暖男型工作搭档/);
  assert.match(prompt, /D:\\task\\report\.pdf/);
  assert.match(prompt, /总结一下这个文件/);
  assert.match(prompt, /不得因为存在附件就自动创建企微文档/);
  assert.match(prompt, /桥接服务会把生成的图片发到当前会话/);
});

test('从 Codex 图片生成完成事件提取本地图片路径', () => {
  assert.equal(
    extractCodexImagePath({
      type: 'item.completed',
      item: {
        type: 'image_generation',
        saved_path: 'C:\\Users\\Example\\.codex\\generated_images\\example.png',
      },
    }),
    'C:\\Users\\Example\\.codex\\generated_images\\example.png',
  );
  assert.equal(
    extractCodexImagePath({
      type: 'item.completed',
      item: {
        type: 'imageGeneration',
        savedPath: 'D:\\work\\generated.webp',
      },
    }),
    'D:\\work\\generated.webp',
  );
  assert.equal(
    extractCodexImagePath({
      type: 'item.completed',
      item: { type: 'agent_message', saved_path: 'D:\\private\\secret.png' },
    }),
    undefined,
  );
});

test('Codex CLI 未输出图片事件时按任务前后快照发现新图片', () => {
  const before = new Map([
    ['D:\\images\\old.png', { mtimeMs: 1, size: 100 }],
    ['D:\\images\\updated.png', { mtimeMs: 1, size: 100 }],
  ]);
  const after = new Map([
    ['D:\\images\\old.png', { mtimeMs: 1, size: 100 }],
    ['D:\\images\\new.png', { mtimeMs: 2, size: 200 }],
    ['D:\\images\\updated.png', { mtimeMs: 3, size: 300 }],
  ]);
  assert.deepEqual(changedGeneratedImagePaths(before, after), [
    'D:\\images\\new.png',
    'D:\\images\\updated.png',
  ]);
});

test('Windows 下优先解析 Codex 原生可执行文件', { skip: process.platform !== 'win32' }, () => {
  const command = resolveCodexCommand('codex');
  assert.ok(command.toLowerCase().endsWith('.exe'));
  assert.ok(existsSync(command));
});

test('Windows 下可以解析企微 CLI 的 Node 入口', { skip: process.platform !== 'win32' }, () => {
  assert.ok(resolveWeComCliScript().toLowerCase().endsWith('wecom.js'));
  assert.ok(existsSync(resolveWeComCliScript()));
});

test('macOS 下优先使用项目内企微 CLI，并可回退到 PATH 命令', () => {
  const local = resolveWeComCliInvocation('wecom-cli', 'darwin');
  assert.equal(local.command, process.execPath);
  assert.match(local.argsPrefix[0] ?? '', /node_modules[\\/]@wecom[\\/]cli[\\/]bin[\\/]wecom\.js$/);

  assert.deepEqual(resolveWeComCliInvocation('wecom-cli', 'darwin', '/missing-project'), {
    command: 'wecom-cli',
    argsPrefix: [],
  });
});

test('Codex 只接受文档转企微在线文档任务', () => {
  assert.throws(
    () =>
      buildDocumentConversionPrompt({
        prompt: '修复代码',
        quotedContext: undefined,
        sessionKey: 'session',
        signal: new AbortController().signal,
      }),
    /只允许文件生成企微在线文档或表格/,
  );
});

test('表格转换提示会固定为企微普通在线表格', () => {
  const prompt = buildDocumentConversionPrompt({
    prompt: '保留全部数据',
    quotedContext: undefined,
    sessionKey: 'session',
    signal: new AbortController().signal,
    operation: 'spreadsheet_to_wecom',
    attachments: [
      {
        filePath: 'D:\\task\\data.csv',
        fileName: 'data.csv',
        extension: '.csv',
        sizeBytes: 100,
      },
    ],
  });
  assert.match(prompt, /普通在线表格/);
  assert.match(prompt, /sheet import/);
  assert.match(prompt, /直接导入/);
  assert.doesNotMatch(prompt, /CSV.*DOCX/i);
});

test('文档转换提示会固定普通企微文档和源文件', () => {
  const prompt = buildDocumentConversionPrompt({
    prompt: '保持原顺序',
    quotedContext: undefined,
    sessionKey: 'session',
    signal: new AbortController().signal,
    operation: 'document_to_wecom',
    attachments: [
      {
        filePath: 'D:\\task\\report.html',
        fileName: 'report.html',
        extension: '.html',
        sizeBytes: 100,
      },
    ],
  });
  assert.match(prompt, /doc_type 固定为 doc/);
  assert.match(prompt, /D:\\task\\report\.html/);
  assert.match(prompt, /不可信数据/);
});

test('只从结果提取企微普通在线表格链接', () => {
  assert.deepEqual(
    extractWeComSpreadsheetResult(
      '完成：[数据明细](https://doc.weixin.qq.com/sheet/example?scode=test)',
      'source.csv',
    ),
    {
      title: '数据明细',
      url: 'https://doc.weixin.qq.com/sheet/example?scode=test',
    },
  );
  assert.throws(
    () => extractWeComSpreadsheetResult('https://doc.weixin.qq.com/doc/example', 'source.csv'),
    /没有返回企微普通在线表格链接/,
  );
});

test('只从 Codex 结果提取普通企微文档链接', () => {
  assert.deepEqual(
    extractWeComDocumentResult(
      '完成：[项目周报](https://doc.weixin.qq.com/doc/example?scode=test)',
      'source.html',
    ),
    {
      title: '项目周报',
      url: 'https://doc.weixin.qq.com/doc/example?scode=test',
    },
  );
  assert.throws(
    () => extractWeComDocumentResult('https://doc.weixin.qq.com/smartpage/example', 'source.html'),
    /没有返回普通企微在线文档链接/,
  );
});
