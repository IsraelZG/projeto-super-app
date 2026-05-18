export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type LogCategory = 'SQLite' | 'WebRTC' | 'CRDT' | 'SyncWorker' | 'UI';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta?: any;
}

function sanitizeMeta(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  
  if (typeof obj.toJSON === 'function') {
    try {
      return obj.toJSON();
    } catch {
      // Fallback
    }
  }

  const seen = new WeakSet();
  try {
    const safeObj = JSON.parse(JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    }));
    return safeObj;
  } catch {
    return '[Unserializable]';
  }
}

export class StructuredLogger {
  private buffer: LogEntry[] = [];
  private maxBufferSize = 500;
  private minLevel: LogLevel = 'DEBUG';

  constructor(minLevel: LogLevel = 'DEBUG') {
    this.minLevel = minLevel;
  }

  public setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  private levelValue(level: LogLevel): number {
    const values: Record<LogLevel, number> = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
    };
    return values[level];
  }

  private pushToBuffer(entry: LogEntry) {
    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift(); // Remove oldest
    }
    this.buffer.push(entry);
  }

  public getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  public clearLogs() {
    this.buffer = [];
  }

  private log(level: LogLevel, category: LogCategory, message: string, meta?: any) {
    const sanitizedMeta = meta !== undefined ? sanitizeMeta(meta) : undefined;
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      meta: sanitizedMeta,
    };

    this.pushToBuffer(entry);

    if (this.levelValue(level) < this.levelValue(this.minLevel)) {
      return;
    }

    const timestampStr = new Date(entry.timestamp).toISOString().split('T')[1].slice(0, -1);
    
    // Check if we are in browser or worker context
    const isBrowser = typeof window !== 'undefined' || (typeof self !== 'undefined' && typeof (self as any).importScripts !== 'undefined');
    
    if (isBrowser) {
      const colors = {
        SQLite: 'background: #e0f7fa; color: #006064; padding: 1px 4px; border-radius: 3px; font-weight: bold;',
        WebRTC: 'background: #e8f5e9; color: #1b5e20; padding: 1px 4px; border-radius: 3px; font-weight: bold;',
        CRDT: 'background: #f3e5f5; color: #4a148c; padding: 1px 4px; border-radius: 3px; font-weight: bold;',
        SyncWorker: 'background: #fff3e0; color: #e65100; padding: 1px 4px; border-radius: 3px; font-weight: bold;',
        UI: 'background: #ffebee; color: #b71c1c; padding: 1px 4px; border-radius: 3px; font-weight: bold;',
      };

      const levelColors = {
        DEBUG: 'color: #757575; font-weight: bold;',
        INFO: 'color: #1e88e5; font-weight: bold;',
        WARN: 'color: #fb8c00; font-weight: bold;',
        ERROR: 'color: #e53935; font-weight: bold;',
      };

      const consoleArgs = [
        `%c[${timestampStr}] %c[${level}] %c[${category}] %c${message}`,
        'color: #9e9e9e;',
        levelColors[level],
        colors[category],
        'color: inherit;',
      ];

      if (sanitizedMeta !== undefined) {
        consoleArgs.push(sanitizedMeta);
      }

      if (level === 'ERROR') {
        console.error(...consoleArgs);
      } else if (level === 'WARN') {
        console.warn(...consoleArgs);
      } else {
        console.log(...consoleArgs);
      }
    } else {
      // Node.js / CLI testing environments
      const logStr = `[${timestampStr}] [${level}] [${category}] ${message}`;
      if (level === 'ERROR') {
        console.error(logStr, meta !== undefined ? meta : '');
      } else if (level === 'WARN') {
        console.warn(logStr, meta !== undefined ? meta : '');
      } else {
        console.log(logStr, meta !== undefined ? meta : '');
      }
    }
  }

  public debug(category: LogCategory, message: string, meta?: any) {
    this.log('DEBUG', category, message, meta);
  }

  public info(category: LogCategory, message: string, meta?: any) {
    this.log('INFO', category, message, meta);
  }

  public warn(category: LogCategory, message: string, meta?: any) {
    this.log('WARN', category, message, meta);
  }

  public error(category: LogCategory, message: string, meta?: any) {
    this.log('ERROR', category, message, meta);
  }
}

export const logger = new StructuredLogger();
