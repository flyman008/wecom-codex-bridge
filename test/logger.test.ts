import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeLogText } from '../src/logger.js';

test('SDK 回调日志不会保留消息正文、内部标识或密钥', () => {
  const raw =
    '[server -> plugin] cmd=aibot_msg_callback, reqId=request-1, body={"userid":"user-1","content":"内部文档","aeskey":"key-1"}';
  const safe = sanitizeLogText(raw);
  assert.equal(safe, '[server -> plugin] cmd=aibot_msg_callback');
  assert.doesNotMatch(safe, /request-1|user-1|内部文档|key-1|aeskey|body/i);
});

test('普通日志中的地址和认证参数会被脱敏', () => {
  const safe = sanitizeLogText('url=https://example.test/private secret=abc token=def');
  assert.doesNotMatch(safe, /example\.test|abc|def/);
  assert.match(safe, /\[url\]/);
});
