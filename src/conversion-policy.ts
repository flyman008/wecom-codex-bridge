import type { AgentAttachment, AgentOperation } from './types.js';

export const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.et']);

const CONVERSION_ACTION = '(?:生成|创建|新建|转换|转成|做成|导入|上传)';
const WECOM_TARGET = '(?:(?:企业微信|企微)(?:普通)?(?:在线)?(?:文档|表格)|在线(?:文档|表格))';
const actionBeforeTarget = new RegExp(`${CONVERSION_ACTION}.{0,24}${WECOM_TARGET}`, 'iu');
const targetBeforeAction = new RegExp(`${WECOM_TARGET}.{0,24}${CONVERSION_ACTION}`, 'iu');

export function isWeComConversionRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return actionBeforeTarget.test(normalized) || targetBeforeAction.test(normalized);
}

export function conversionOperationFor(
  attachment: Pick<AgentAttachment, 'extension'>,
): AgentOperation {
  return SPREADSHEET_EXTENSIONS.has(attachment.extension.toLowerCase())
    ? 'spreadsheet_to_wecom'
    : 'document_to_wecom';
}
