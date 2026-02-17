import pino, { Logger } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const isDebug = process.env.DEBUG === 'true' || process.env.DEBUG?.includes('qacr');
const logLevel = process.env.LOG_LEVEL || (isDebug ? 'debug' : 'info');

/**
 * Create a logger instance
 */
export function createLogger(name: string): Logger {
  return pino.default({
    name,
    level: logLevel,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}

/**
 * Default logger instance
 */
export const logger = createLogger('qacr');

export type { Logger };
