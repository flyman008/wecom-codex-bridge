export async function* readSseData(response: Response): AsyncGenerator<string, void> {
  if (!response.body) throw new Error('响应没有可读取的消息体');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
      boundary = buffer.indexOf('\n\n');
    }

    if (done) break;
  }

  const tail = buffer.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trimStart();
}

export function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'output', 'output_text']) {
    if (typeof record[key] === 'string') return record[key];
  }

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === 'object') {
      const choice = first as Record<string, unknown>;
      const delta = choice.delta;
      if (delta && typeof delta === 'object') {
        const content = (delta as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
      }
      const message = choice.message;
      if (message && typeof message === 'object') {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
      }
      if (typeof choice.text === 'string') return choice.text;
    }
  }

  return undefined;
}
