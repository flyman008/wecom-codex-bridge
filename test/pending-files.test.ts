import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  isSupportedDocumentFilename,
  PendingConversionStore,
  PendingFileStore,
  sanitizeIncomingFilename,
} from '../src/pending-files.js';

test('文件名会去除路径和 Windows 非法字符', () => {
  assert.equal(sanitizeIncomingFilename('..\\unsafe\\周报<最终>.html'), '周报_最终_.html');
  assert.equal(isSupportedDocumentFilename('report.PDF'), true);
  assert.equal(isSupportedDocumentFilename('program.exe'), false);
});

test('文档附件可暂存、读取和安全清理', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-router-test-'));
  try {
    const store = new PendingFileStore({
      stagingDir: root,
      maxBytes: 1024,
      attachmentTtlMs: 60_000,
    });
    const saved = await store.store('session', Buffer.from('<h1>测试</h1>'), '测试.html');
    assert.equal(saved.fileName, '测试.html');
    assert.equal((await store.get('session'))?.filePath, saved.filePath);
    await store.remove('session');
    assert.equal(await store.get('session'), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('服务重启后仍可按会话恢复未过期附件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-router-test-'));
  try {
    const config = {
      stagingDir: root,
      maxBytes: 1024,
      attachmentTtlMs: 60_000,
    };
    const firstStore = new PendingFileStore(config);
    const saved = await firstStore.store('session', Buffer.from('test'), '待转换.docx');
    const restartedStore = new PendingFileStore(config);
    assert.equal((await restartedStore.get('session'))?.filePath, saved.filePath);
    await restartedStore.remove('session');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('转换要求会在有效期内等待文件', () => {
  const store = new PendingConversionStore(60_000);
  store.set('session', { prompt: '生成企微在线文档', quotedContext: undefined });
  assert.deepEqual(store.get('session'), {
    prompt: '生成企微在线文档',
    quotedContext: undefined,
  });
  store.remove('session');
  assert.equal(store.get('session'), undefined);

  const expiredStore = new PendingConversionStore(0);
  expiredStore.set('session', { prompt: '生成企微在线文档', quotedContext: undefined });
  assert.equal(expiredStore.get('session'), undefined);
});

test('拒绝非文档文件和超限附件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-router-test-'));
  try {
    const store = new PendingFileStore({
      stagingDir: root,
      maxBytes: 4,
      attachmentTtlMs: 60_000,
    });
    await assert.rejects(() => store.store('session', Buffer.from('abc'), 'program.exe'), /不支持/);
    await assert.rejects(() => store.store('session', Buffer.from('12345'), 'report.txt'), /大小限制/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
