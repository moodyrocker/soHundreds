import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Structured logging.
 *
 * There were 109 bare `console.*` calls across 28 files. The problem was not the
 * formatting — most already carried a hand-written `[scope]` prefix — it was that
 * nothing tied a line to the request, organization or autopilot cycle that
 * produced it. When an unattended agent misfires on a customer's ad account at
 * 3am, `docker compose logs` was the entire forensic trail, and there was no way
 * to ask "show me everything that happened for org X in that cycle".
 *
 * Two things fix that:
 *
 *   1. AsyncLocalStorage. Context set once at the edge (per request, or per
 *      autopilot cycle) is attached to every line logged anywhere beneath it,
 *      without threading a logger through hundreds of function signatures. This
 *      is the whole point — a scoped logger alone would just be prettier
 *      console.log.
 *
 *   2. JSON in production. Log aggregators can filter on requestId /
 *      organizationId as fields. Development stays human-readable, because
 *      reading JSON in a terminal is miserable.
 *
 * Deliberately dependency-free. pino would be faster, but this service's log
 * volume is nowhere near where that matters, and the backend keeps a small
 * dependency set.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && raw in LEVEL_ORDER) return raw as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function useJson(): boolean {
  const raw = process.env.LOG_FORMAT?.trim().toLowerCase();
  if (raw === 'json') return true;
  if (raw === 'pretty') return false;
  return process.env.NODE_ENV === 'production';
}

const threshold = LEVEL_ORDER[configuredLevel()];
const json = useJson();

/**
 * Ambient context for the current async operation.
 *
 * `requestId` correlates an HTTP request; `cycleId` correlates one autopilot
 * pass, which spans many awaits and several services.
 */
export interface LogContext {
  requestId?: string;
  organizationId?: string;
  strategyId?: string;
  cycleId?: string;
  userId?: string;
  [key: string]: unknown;
}

const store = new AsyncLocalStorage<LogContext>();

/** Runs `fn` with `context` attached to every log line inside it. */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const merged = { ...(store.getStore() ?? {}), ...context };
  return store.run(merged, fn);
}

/** Adds fields to the current context, if there is one. */
export function addLogContext(fields: LogContext): void {
  const current = store.getStore();
  if (current) Object.assign(current, fields);
}

export function currentLogContext(): LogContext {
  return { ...(store.getStore() ?? {}) };
}

/**
 * Keys whose values are never printed.
 *
 * Errors from Shopify, Meta and Anthropic routinely echo the request back,
 * including bearer tokens; `mcp_connections.credentials_encrypted` and the
 * decrypted result pass through service code that logs on failure.
 */
const REDACT_KEYS =
  /^(password|token|access_?token|refresh_?token|api_?key|secret|client_?secret|authorization|credentials|credentials_encrypted|encryption_?key|anon_?key|service_?role_?key|cookie|set_?cookie)$/i;

/**
 * Values that look like credentials regardless of the key they sit under.
 *
 * Each entry pairs a pattern with its literal replacement rather than using a
 * callback. An earlier version used one callback for every pattern and inspected
 * `(match, p1, p2)` — but for a pattern with no capture groups, `String.replace`
 * passes `(match, offset, wholeString)`, so the offset was mistaken for a capture
 * group and the entire log message was spliced into itself. Literal `$1`
 * replacements cannot misfire that way.
 */
const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, '***redacted***'], // Anthropic
  [/\bshp(?:at|ca|pa|ss)_[A-Za-z0-9]{8,}/g, '***redacted***'], // Shopify
  [/\bkey-[A-Za-z0-9]{16,}/g, '***redacted***'], // Runway
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '***redacted***'], // JWT
  [/\bEAA[A-Za-z0-9]{20,}/g, '***redacted***'], // Meta long-lived token
  // Password inside a connection string — keep the surrounding structure so the
  // host is still diagnosable.
  [/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+(@)/g, '$1***$2'],
];

function scrubString(input: string): string {
  let out = input;
  for (const [re, replacement] of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack).split('\n').slice(0, 6).join('\n') : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? '***redacted***' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

/**
 * Splits console-style varargs into a message and structured fields.
 *
 * Call sites are overwhelmingly `log.warn('thing failed:', err)` — the shape the
 * codebase already used with console. Rather than rewrite hundreds of them into
 * an object form, accept both:
 *
 *   log.warn('prune skipped', { err })          → fields
 *   log.warn('prune skipped:', err)             → error appended + captured
 *   log.info(`applied ${n} in ${ms}ms`)         → message only
 *
 * A trailing plain object is treated as fields; anything else is appended to the
 * message so nothing is silently dropped.
 */
function normaliseArgs(message: string, rest: unknown[]): { text: string; fields: LogContext } {
  const fields: LogContext = {};
  const parts: string[] = [message];

  for (const arg of rest) {
    if (arg === undefined || arg === null) continue;

    if (arg instanceof Error) {
      // Keep the message inline (that is what a reader wants) and the structured
      // form as a field (that is what a log query wants).
      parts.push(arg.message);
      fields.err = arg;
      continue;
    }

    if (typeof arg === 'object' && !Array.isArray(arg)) {
      Object.assign(fields, arg as LogContext);
      continue;
    }

    parts.push(typeof arg === 'string' ? arg : JSON.stringify(arg));
  }

  return { text: parts.join(' ').replace(/\s+([.,;:])/g, '$1'), fields };
}

function emit(level: LogLevel, scope: string, message: string, rest: unknown[]): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const { text, fields } = normaliseArgs(message, rest);
  const context = store.getStore() ?? {};
  const merged = { ...context, ...fields };
  const safeMessage = scrubString(text);

  if (json) {
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg: safeMessage,
    };
    for (const [k, v] of Object.entries(merged)) {
      record[k] = REDACT_KEYS.test(k) ? '***redacted***' : redact(v);
    }
    // Single write, so a line is never interleaved with another.
    process.stdout.write(JSON.stringify(record) + '\n');
    return;
  }

  // Development: keep the `[scope] message` shape the codebase already used, with
  // context appended so it is visible but not in the way.
  const ctxParts: string[] = [];
  if (merged.requestId) ctxParts.push(`req=${String(merged.requestId).slice(0, 8)}`);
  if (merged.cycleId) ctxParts.push(`cycle=${String(merged.cycleId).slice(0, 8)}`);
  if (merged.organizationId) ctxParts.push(`org=${String(merged.organizationId).slice(0, 8)}`);
  if (merged.strategyId) ctxParts.push(`strategy=${String(merged.strategyId).slice(0, 8)}`);

  const extras = Object.entries(merged).filter(
    ([k]) => !['requestId', 'cycleId', 'organizationId', 'strategyId', 'userId'].includes(k)
  );

  let line = `${LEVEL_LABEL[level]} [${scope}] ${safeMessage}`;
  if (ctxParts.length) line += `  (${ctxParts.join(' ')})`;
  if (extras.length) {
    const shown = Object.fromEntries(
      extras.map(([k, v]) => [k, REDACT_KEYS.test(k) ? '***redacted***' : redact(v)])
    );
    line += ` ${JSON.stringify(shown)}`;
  }

  // stderr for warn/error so they can be separated by the shell.
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export interface Logger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
  /** Narrower scope, e.g. logger('strategy').child('generate'). */
  child(suffix: string): Logger;
}

/**
 * Creates a scoped logger. The scope replaces the hand-written `[prefix]` that
 * most call sites already had, so log output is broadly unchanged in development.
 */
export function logger(scope: string): Logger {
  return {
    debug: (m, ...rest) => emit('debug', scope, m, rest),
    info: (m, ...rest) => emit('info', scope, m, rest),
    warn: (m, ...rest) => emit('warn', scope, m, rest),
    error: (m, ...rest) => emit('error', scope, m, rest),
    child: (suffix) => logger(`${scope}:${suffix}`),
  };
}

/** Normalises a caught value into a message plus structured error field. */
export function errFields(err: unknown): LogContext {
  if (err instanceof Error) return { err: redact(err) };
  return { err: scrubString(String(err)) };
}

/** Shorthand for the very common `err instanceof Error ? err.message : err`. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
