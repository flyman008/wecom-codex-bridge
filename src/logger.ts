import { createHash } from 'node:crypto';

type Details = Record<string, unknown>;

export function sanitizeLogText(message: string): string {
  const sdkFrame = message.match(/\[(server -> plugin|plugin -> server)\]/i);
  if (sdkFrame) {
    const command = message.match(/\bcmd=([^,\s]+)/i)?.[1];
    return `[${sdkFrame[1]}] ${command ? `cmd=${command}` : 'SDK frame'}`;
  }
  return message
    .replace(/(?:https?|wss):\/\/[^\s,]+/gi, '[url]')
    .replace(/\b(reqid|secret|aeskey|access_token|token)\s*[:=]\s*[^\s,]+/gi, '$1=[redacted]');
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: Details): void {
  const payload = {
    time: new Date().toISOString(),
    level,
    message: sanitizeLogText(message),
    ...(details ? { details } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, details?: Details) => emit('debug', message, details),
  info: (message: string, details?: Details) => emit('info', message, details),
  warn: (message: string, details?: Details) => emit('warn', message, details),
  error: (message: string, error?: unknown, details?: Details) => {
    const safeError = error instanceof Error ? { error: sanitizeLogText(error.message), name: error.name } : {};
    emit('error', message, { ...safeError, ...details });
  },
};

export const sdkLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug(sanitizeLogText(message), { argCount: args.length }),
  info: (message: string, ...args: unknown[]) => logger.info(sanitizeLogText(message), { argCount: args.length }),
  warn: (message: string, ...args: unknown[]) => logger.warn(sanitizeLogText(message), { argCount: args.length }),
  error: (message: string, ...args: unknown[]) =>
    logger.error(sanitizeLogText(message), undefined, { argCount: args.length }),
};

export function privateLabel(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}
