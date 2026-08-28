import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { AppConfig } from './config.js';
import type { AgentAttachment } from './types.js';

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.txt',
  '.rtf',
  '.doc',
  '.docx',
  '.pdf',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.wps',
  '.et',
  '.dps',
  '.ofd',
]);

interface StoredAttachment extends AgentAttachment {
  taskDirectory: string;
  expiresAt: number;
}

export interface PendingConversionIntent {
  prompt: string;
  quotedContext: string | undefined;
}

interface StoredConversionIntent extends PendingConversionIntent {
  expiresAt: number;
}

export function sanitizeIncomingFilename(value: string | undefined): string {
  const leaf = basename((value ?? '').replaceAll('\\', '/')).trim();
  const cleaned = leaf
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  return cleaned || 'document';
}

export function isSupportedDocumentFilename(filename: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(extname(filename).toLowerCase());
}

export class PendingFileStore {
  private readonly root: string;
  private readonly entries = new Map<string, StoredAttachment>();

  constructor(private readonly config: AppConfig['documents']) {
    this.root = resolve(config.stagingDir);
  }

  async store(sessionKey: string, buffer: Buffer, receivedFilename: string | undefined): Promise<AgentAttachment> {
    if (buffer.length > this.config.maxBytes) {
      throw new Error(`文件超过大小限制（最大 ${Math.floor(this.config.maxBytes / 1024 / 1024)} MB）`);
    }
    const fileName = sanitizeIncomingFilename(receivedFilename);
    if (!isSupportedDocumentFilename(fileName)) {
      throw new Error('暂不支持该文件类型。支持 HTML、Markdown、TXT、Word、PDF、PPT、Excel、CSV 等常见文档。');
    }

    await this.get(sessionKey);
    await this.remove(sessionKey);
    const sessionLabel = createHash('sha256').update(sessionKey).digest('hex').slice(0, 12);
    const taskDirectory = join(this.root, `${sessionLabel}-${randomUUID()}`);
    await mkdir(taskDirectory, { recursive: true });
    const filePath = join(taskDirectory, fileName);
    await writeFile(filePath, buffer, { flag: 'wx' });
    const entry: StoredAttachment = {
      filePath,
      fileName,
      extension: extname(fileName).toLowerCase(),
      sizeBytes: buffer.length,
      taskDirectory,
      expiresAt: Date.now() + this.config.attachmentTtlMs,
    };
    this.entries.set(sessionKey, entry);
    return entry;
  }

  async get(sessionKey: string): Promise<AgentAttachment | undefined> {
    let entry = this.entries.get(sessionKey);
    if (!entry) {
      entry = await this.recover(sessionKey);
      if (entry) this.entries.set(sessionKey, entry);
    }
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      await this.remove(sessionKey);
      return undefined;
    }
    return entry;
  }

  async remove(sessionKey: string): Promise<void> {
    const entry = this.entries.get(sessionKey);
    if (!entry) return;
    this.entries.delete(sessionKey);
    const relativePath = relative(this.root, entry.taskDirectory);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('拒绝清理暂存目录之外的路径');
    }
    await rm(entry.taskDirectory, { recursive: true, force: true });
  }

  private async recover(sessionKey: string): Promise<StoredAttachment | undefined> {
    const sessionLabel = createHash('sha256').update(sessionKey).digest('hex').slice(0, 12);
    try {
      const candidates = await Promise.all(
        (await readdir(this.root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${sessionLabel}-`))
          .map(async (entry) => {
            const taskDirectory = join(this.root, entry.name);
            return { taskDirectory, modifiedAt: (await stat(taskDirectory)).mtimeMs };
          }),
      );
      candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
      const newest = candidates[0];
      if (!newest) return undefined;

      const files = (await readdir(newest.taskDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && isSupportedDocumentFilename(entry.name))
        .map((entry) => entry.name);
      const fileName = files[0];
      if (!fileName) return undefined;
      const filePath = join(newest.taskDirectory, fileName);
      const fileStats = await stat(filePath);
      return {
        filePath,
        fileName,
        extension: extname(fileName).toLowerCase(),
        sizeBytes: fileStats.size,
        taskDirectory: newest.taskDirectory,
        expiresAt: fileStats.mtimeMs + this.config.attachmentTtlMs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

export class PendingConversionStore {
  private readonly entries = new Map<string, StoredConversionIntent>();

  constructor(private readonly ttlMs: number) {}

  set(sessionKey: string, intent: PendingConversionIntent): void {
    this.entries.set(sessionKey, { ...intent, expiresAt: Date.now() + this.ttlMs });
  }

  get(sessionKey: string): PendingConversionIntent | undefined {
    const entry = this.entries.get(sessionKey);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(sessionKey);
      return undefined;
    }
    return { prompt: entry.prompt, quotedContext: entry.quotedContext };
  }

  remove(sessionKey: string): void {
    this.entries.delete(sessionKey);
  }
}
