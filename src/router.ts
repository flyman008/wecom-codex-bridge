import type { AgentName, RouteDecision } from './types.js';

export const HELP_TEXT = [
  '我能帮你：',
  '- 回答工作问题',
  '- Word、PDF 等生成企微普通在线文档',
  '- CSV、Excel 等生成企微普通在线表格',
  '- 文件和要求先发哪个都行',
  '',
  '快捷指令：',
  '- `/ask 问题`',
  '- `/local 任务`',
  '- `/help`',
  '',
  '需要生成时，直接说“生成企微在线文档”就好，我会按文件类型选择文档或表格。',
].join('\n');

export function normalizeIncomingText(content: string, isGroup: boolean): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!isGroup) return normalized;
  return normalized.replace(/^\s*@[^\s]+\s*/u, '').trim();
}

export function decideRoute(content: string, fallback: AgentName): RouteDecision {
  const text = content.trim();
  if (!text || /^\/help(?:\s|$)/i.test(text)) {
    return { prompt: '', directReply: HELP_TEXT };
  }

  const match = text.match(/^\/(ask|codex|local)(?:\s+|$)([\s\S]*)$/i);
  if (!match) return { prompt: text, requiresSemanticRouting: true };

  const command = match[1]?.toLowerCase();
  const prompt = match[2]?.trim() ?? '';
  if (!prompt) {
    return { prompt: '', directReply: '指令后面把要做的事写上就好。\n\n' + HELP_TEXT };
  }

  if (command === 'codex') {
    return {
      prompt: '',
      directReply: '这个指令不用啦。发文件，再告诉我“生成企微在线文档”就好。',
    };
  }

  const agent: AgentName = command === 'ask' ? 'llm' : (command as AgentName);
  return { agent, prompt };
}
