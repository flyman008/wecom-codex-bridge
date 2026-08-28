import assert from 'node:assert/strict';
import test from 'node:test';

import { conversionOperationFor, isWeComConversionRequest } from '../src/conversion-policy.js';

test('CSV 和 Excel 生成普通在线表格，其他文档生成普通在线文档', () => {
  for (const extension of ['.csv', '.tsv', '.xls', '.xlsx', '.et']) {
    assert.equal(conversionOperationFor({ extension }), 'spreadsheet_to_wecom');
  }
  for (const extension of ['.docx', '.pdf', '.html', '.md']) {
    assert.equal(conversionOperationFor({ extension }), 'document_to_wecom');
  }
});

test('本地规则只识别明确的企微文档或表格转换要求', () => {
  assert.equal(isWeComConversionRequest('用这个 HTML 生成企微在线文档'), true);
  assert.equal(isWeComConversionRequest('把 CSV 转成企业微信表格'), true);
  assert.equal(isWeComConversionRequest('企微在线文档帮我创建一下'), true);
  assert.equal(isWeComConversionRequest('总结一下这个文件'), false);
  assert.equal(isWeComConversionRequest('创建一个本地 Markdown 文件'), false);
});
