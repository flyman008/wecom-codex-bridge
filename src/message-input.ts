export const HELP_TEXT = [
  '我能帮你：',
  '- 回答工作问题',
  '- Word、PDF 等生成企微普通在线文档',
  '- CSV、Excel 等生成企微普通在线表格',
  '- 文件和要求先发哪个都行',
  '',
  '发送 `/help` 可以再次查看这段说明。',
  '',
  '需要生成时，直接说“生成企微在线文档”就好，我会按文件类型选择文档或表格。',
].join('\n');

export function normalizeIncomingText(content: string, isGroup: boolean): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!isGroup) return normalized;
  return normalized.replace(/^\s*@[^\s]+\s*/u, '').trim();
}

export function isHelpRequest(content: string): boolean {
  const text = content.trim();
  return !text || /^\/help(?:\s|$)/i.test(text);
}
