export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogAttributes = Record<string, unknown>;

export type LogRecord = {
  level: LogLevel;
  message: string;
  attributes: LogAttributes;
  correlationId?: string;
};

export type LogSink = (record: LogRecord) => void;

const sensitiveKey = /(^|_)(access|authorization|cookie|key|password|secret|token)(_|$)/i;
const maxStringLength = 512;

function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map(item => redact(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]),
    );
  }
  return value;
}

export function redactAttributes(attributes: LogAttributes): LogAttributes {
  return redact(attributes) as LogAttributes;
}

function defaultSink(record: LogRecord): void {
  const attributes = Object.keys(record.attributes).length > 0 ? record.attributes : undefined;
  const payload = record.correlationId ? { ...attributes, correlationId: record.correlationId } : attributes;
  const method = record.level === "debug" ? "debug" : record.level;
  console[method](record.message, payload ?? "");
}

export class ProviderNeutralLogger {
  constructor(
    private readonly sink: LogSink = defaultSink,
    private readonly minimumLevel: LogLevel = "info",
    private readonly correlationId?: string,
  ) {}

  child(correlationId = createCorrelationId()): ProviderNeutralLogger {
    return new ProviderNeutralLogger(this.sink, this.minimumLevel, correlationId);
  }

  debug(message: string, attributes: LogAttributes = {}): void {
    this.write("debug", message, attributes);
  }

  info(message: string, attributes: LogAttributes = {}): void {
    this.write("info", message, attributes);
  }

  warn(message: string, attributes: LogAttributes = {}): void {
    this.write("warn", message, attributes);
  }

  error(message: string, attributes: LogAttributes = {}): void {
    this.write("error", message, attributes);
  }

  private write(level: LogLevel, message: string, attributes: LogAttributes): void {
    if (levelWeight[level] < levelWeight[this.minimumLevel]) {
      return;
    }
    this.sink({
      level,
      message,
      attributes: redactAttributes(attributes),
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
    });
  }
}

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `correlation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const logger = new ProviderNeutralLogger();
