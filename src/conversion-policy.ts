import type { AgentAttachment, AgentOperation } from './types.js';

export const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.et']);

export function conversionOperationFor(
  attachment: Pick<AgentAttachment, 'extension'>,
): AgentOperation {
  return SPREADSHEET_EXTENSIONS.has(attachment.extension.toLowerCase())
    ? 'spreadsheet_to_wecom'
    : 'document_to_wecom';
}
