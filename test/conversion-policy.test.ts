import assert from 'node:assert/strict';
import test from 'node:test';

import { conversionOperationFor } from '../src/conversion-policy.js';

test('CSV 和 Excel 生成普通在线表格，其他文档生成普通在线文档', () => {
  for (const extension of ['.csv', '.tsv', '.xls', '.xlsx', '.et']) {
    assert.equal(conversionOperationFor({ extension }), 'spreadsheet_to_wecom');
  }
  for (const extension of ['.docx', '.pdf', '.html', '.md']) {
    assert.equal(conversionOperationFor({ extension }), 'document_to_wecom');
  }
});
