import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { detectImageExtension, IncomingImageStore } from '../src/incoming-images.js';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');

test('图片格式可以从文件名或文件头识别', () => {
  assert.equal(detectImageExtension(Buffer.from('data'), 'photo.WEBP'), '.webp');
  assert.equal(detectImageExtension(png, undefined), '.png');
  assert.equal(detectImageExtension(jpeg, 'unknown.bin'), '.jpg');
  assert.equal(detectImageExtension(Buffer.from('text'), 'unknown.bin'), undefined);
});

test('多张企微图片会独立暂存并可安全清理', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-images-test-'));
  try {
    const store = new IncomingImageStore({
      stagingDir: root,
      maxBytes: 1024,
      attachmentTtlMs: 60_000,
    });
    const batch = await store.store('session', [
      { buffer: png, filename: '第一张.png' },
      { buffer: jpeg, filename: undefined },
    ]);
    assert.equal(batch.attachments.length, 2);
    assert.equal(batch.attachments[0]?.extension, '.png');
    assert.equal(batch.attachments[1]?.extension, '.jpg');
    assert.deepEqual(await readFile(batch.attachments[0]?.filePath ?? ''), png);
    await store.remove(batch.taskDirectory);
    await assert.rejects(() => readFile(batch.attachments[0]?.filePath ?? ''), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
