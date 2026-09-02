import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { AppConfig } from './config.js';
import { sanitizeIncomingFilename } from './pending-files.js';
import type { AgentAttachment } from './types.js';

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

export interface DownloadedImage {
  buffer: Buffer;
  filename: string | undefined;
}

export interface StoredImageBatch {
  attachments: AgentAttachment[];
  taskDirectory: string;
}

export function detectImageExtension(buffer: Buffer, filename: string | undefined): string | undefined {
  const namedExtension = extname(filename ?? '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(namedExtension)) return namedExtension;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return '.png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
    return '.gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return undefined;
}

export class IncomingImageStore {
  private readonly root: string;

  constructor(private readonly config: AppConfig['documents']) {
    this.root = join(resolve(config.stagingDir), '_images');
  }

  async store(sessionKey: string, images: readonly DownloadedImage[]): Promise<StoredImageBatch> {
    if (images.length === 0) throw new Error('没有可暂存的图片');
    if (images.length > 9) throw new Error('一次最多处理9张图片');
    const totalBytes = images.reduce((total, image) => total + image.buffer.length, 0);
    if (totalBytes > this.config.maxBytes) {
      throw new Error(`图片总大小超过限制（最大 ${Math.floor(this.config.maxBytes / 1024 / 1024)} MB）`);
    }

    const sessionLabel = createHash('sha256').update(sessionKey).digest('hex').slice(0, 12);
    const taskDirectory = join(this.root, `${sessionLabel}-${randomUUID()}`);
    await mkdir(taskDirectory, { recursive: true });
    try {
      const attachments: AgentAttachment[] = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        if (!image) continue;
        const extension = detectImageExtension(image.buffer, image.filename);
        if (!extension) throw new Error('收到的图片格式暂不支持');
        const originalName = sanitizeIncomingFilename(image.filename);
        const stem = IMAGE_EXTENSIONS.has(extname(originalName).toLowerCase())
          ? originalName.slice(0, -extname(originalName).length)
          : `image-${index + 1}`;
        const fileName = `${index + 1}-${stem}${extension}`;
        const filePath = join(taskDirectory, fileName);
        await writeFile(filePath, image.buffer, { flag: 'wx' });
        attachments.push({
          filePath,
          fileName,
          extension,
          sizeBytes: image.buffer.length,
        });
      }
      return { attachments, taskDirectory };
    } catch (error) {
      await this.remove(taskDirectory);
      throw error;
    }
  }

  async remove(taskDirectory: string): Promise<void> {
    const relativePath = relative(this.root, taskDirectory);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('拒绝清理图片暂存目录之外的路径');
    }
    await rm(taskDirectory, { recursive: true, force: true });
  }
}
