import { readFile } from 'node:fs/promises';

import type { AppConfig } from './config.js';

interface PersonaProfileValue {
  version: 1;
  name: string;
  personaPrompt: string;
  offTopicReminder: string;
  offTopicReminderThreshold: number;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseProfile(value: unknown): PersonaProfileValue {
  if (!value || typeof value !== 'object') throw new Error('机器人人设文件不是对象');
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    typeof record.personaPrompt !== 'string' ||
    !record.personaPrompt.trim() ||
    typeof record.offTopicReminder !== 'string' ||
    !nonNegativeInteger(record.offTopicReminderThreshold) ||
    (record.offTopicReminderThreshold > 0 && !record.offTopicReminder.trim())
  ) {
    throw new Error('机器人人设文件字段无效');
  }
  return {
    version: 1,
    name: record.name.trim(),
    personaPrompt: record.personaPrompt.trim(),
    offTopicReminder: record.offTopicReminder.trim(),
    offTopicReminderThreshold: record.offTopicReminderThreshold,
  };
}

export class PersonaProfile {
  private constructor(private readonly value: PersonaProfileValue) {}

  static async load(config: AppConfig['persona']): Promise<PersonaProfile> {
    const value = parseProfile(JSON.parse(await readFile(config.profilePath, 'utf8')));
    return new PersonaProfile(value);
  }

  get name(): string {
    return this.value.name;
  }

  get prompt(): string {
    if (this.value.offTopicReminderThreshold === 0) return this.value.personaPrompt;
    return [
      this.value.personaPrompt,
      `如果当前会话里同一位用户已经连续 ${this.value.offTopicReminderThreshold} 次询问明显与工作无关的问题，在回答末尾提醒：“${this.value.offTopicReminder}”`,
    ].join('\n');
  }
}
