import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PersonaProfile } from '../src/persona-profile.js';

test('人设和可选偏题提醒直接组成 Codex 提示词', async () => {
  const root = await mkdtemp(join(tmpdir(), 'persona-profile-test-'));
  const profilePath = join(root, 'profile.json');
  try {
    await writeFile(
      profilePath,
      JSON.stringify({
        version: 1,
        name: '测试助手',
        personaPrompt: '回答简洁。',
        offTopicReminder: '回到工作吧。',
        offTopicReminderThreshold: 3,
      }),
      'utf8',
    );
    const profile = await PersonaProfile.load({ profilePath });
    assert.equal(profile.name, '测试助手');
    assert.match(profile.prompt, /回答简洁/);
    assert.match(profile.prompt, /连续 3 次/);
    assert.match(profile.prompt, /回到工作吧/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
