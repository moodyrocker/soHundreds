import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The logger is worth testing for one specific reason: it redacts credentials.
 *
 * Upstream errors from Shopify, Meta and Anthropic routinely echo the request
 * back, tokens included, and service code logs those errors on failure. A
 * redaction bug does not fail loudly — it quietly writes a live access token into
 * a log aggregator that a wider group of people can read than can read the
 * database.
 *
 * The redaction helper has already had exactly that kind of bug: it used one
 * callback for every pattern and inspected `(match, p1, p2)`, but for a pattern
 * with no capture groups `String.replace` passes `(match, offset, wholeString)` —
 * so the offset was treated as a capture group and the whole log message was
 * spliced into itself. These tests exist so that cannot recur.
 */

const captured: string[] = [];

async function loadLogger(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import('./logger.js');
}

beforeEach(() => {
  captured.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_FORMAT;
  delete process.env.LOG_LEVEL;
});

/** Last emitted line, parsed as JSON. */
function lastRecord(): Record<string, unknown> {
  const line = captured.at(-1);
  if (!line) throw new Error('nothing was logged');
  return JSON.parse(line) as Record<string, unknown>;
}

describe('json output', () => {
  it('emits ts, level, scope and msg', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json', LOG_LEVEL: 'debug' });
    logger('svc').info('started');
    const r = lastRecord();
    expect(r.level).toBe('info');
    expect(r.scope).toBe('svc');
    expect(r.msg).toBe('started');
    expect(typeof r.ts).toBe('string');
  });

  it('writes exactly one line per call, so records never interleave', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').info('one');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.endsWith('\n')).toBe(true);
    expect(captured[0]!.trimEnd().includes('\n')).toBe(false);
  });

  it('merges a trailing object as structured fields', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').info('done', { durationMs: 42, count: 3 });
    const r = lastRecord();
    expect(r.durationMs).toBe(42);
    expect(r.count).toBe(3);
  });

  it('folds an Error into the message and captures it as a field', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').warn('publish failed:', new Error('rate limited'));
    const r = lastRecord();
    expect(String(r.msg)).toContain('rate limited');
    expect((r.err as { name: string }).name).toBe('Error');
    expect((r.err as { message: string }).message).toBe('rate limited');
  });

  it('truncates a stack rather than logging hundreds of frames', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').error('boom', new Error('deep'));
    const stack = (lastRecord().err as { stack?: string }).stack ?? '';
    expect(stack.split('\n').length).toBeLessThanOrEqual(6);
  });

  it('appends a non-object extra arg to the message instead of dropping it', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').info('count is', 7);
    expect(String(lastRecord().msg)).toContain('7');
  });
});

describe('level threshold', () => {
  it('suppresses debug when the level is info', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json', LOG_LEVEL: 'info' });
    const log = logger('svc');
    log.debug('hidden');
    expect(captured).toHaveLength(0);
    log.info('shown');
    expect(captured).toHaveLength(1);
  });

  it('suppresses everything below error when the level is error', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json', LOG_LEVEL: 'error' });
    const log = logger('svc');
    log.debug('no');
    log.info('no');
    log.warn('no');
    expect(captured).toHaveLength(0);
    log.error('yes');
    expect(captured).toHaveLength(1);
  });
});

describe('context propagation', () => {
  it('attaches context to a line logged inside the scope', async () => {
    const { logger, withLogContext } = await loadLogger({ LOG_FORMAT: 'json' });
    withLogContext({ requestId: 'req-1', organizationId: 'org-1' }, () => {
      logger('svc').info('inside');
    });
    const r = lastRecord();
    expect(r.requestId).toBe('req-1');
    expect(r.organizationId).toBe('org-1');
  });

  it('survives awaits and nested async calls', async () => {
    // This is the whole point of AsyncLocalStorage here: a cycle spans many awaits
    // across several services and must stay correlated without passing an id down
    // through every signature.
    const { logger, withLogContext } = await loadLogger({ LOG_FORMAT: 'json' });
    async function deep() {
      await new Promise((r) => setTimeout(r, 5));
      logger('svc').error('deep failure');
    }
    await withLogContext({ cycleId: 'cycle-9' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      await deep();
    });
    expect(lastRecord().cycleId).toBe('cycle-9');
  });

  it('keeps concurrent contexts separate', async () => {
    // Two in-flight requests must not see each other's ids.
    const { logger, withLogContext } = await loadLogger({ LOG_FORMAT: 'json' });
    await Promise.all([
      withLogContext({ requestId: 'A' }, async () => {
        await new Promise((r) => setTimeout(r, 15));
        logger('svc').info('from A');
      }),
      withLogContext({ requestId: 'B' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        logger('svc').info('from B');
      }),
    ]);
    const records = captured.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.find((r) => r.msg === 'from A')!.requestId).toBe('A');
    expect(records.find((r) => r.msg === 'from B')!.requestId).toBe('B');
  });

  it('addLogContext is visible to lines logged afterwards', async () => {
    // tenantMiddleware resolves the organization after attachRequestId has already
    // opened the context, and mutates it in place.
    const { logger, addLogContext, withLogContext } = await loadLogger({ LOG_FORMAT: 'json' });
    await withLogContext({ requestId: 'req-2' }, async () => {
      addLogContext({ organizationId: 'org-late' });
      await new Promise((r) => setTimeout(r, 5));
      logger('svc').info('after tenant resolved');
    });
    const r = lastRecord();
    expect(r.requestId).toBe('req-2');
    expect(r.organizationId).toBe('org-late');
  });

  it('logs fine with no context at all', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').info('no context');
    expect(lastRecord().msg).toBe('no context');
  });

  it('explicit fields win over ambient context', async () => {
    const { logger, withLogContext } = await loadLogger({ LOG_FORMAT: 'json' });
    withLogContext({ organizationId: 'ambient' }, () => {
      logger('svc').info('override', { organizationId: 'explicit' });
    });
    expect(lastRecord().organizationId).toBe('explicit');
  });
});

describe('redaction', () => {
  it('redacts by key name', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').error('upstream rejected', {
      access_token: 'shpat_livetoken1234',
      password: 'hunter2',
      client_secret: 'abc',
      credentials_encrypted: 'v1:xyz',
    });
    const r = lastRecord();
    for (const key of ['access_token', 'password', 'client_secret', 'credentials_encrypted']) {
      expect(r[key]).toBe('***redacted***');
    }
  });

  it('redacts nested keys', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').error('nested', { outer: { inner: { api_key: 'sk-ant-secret' } } });
    const outer = lastRecord().outer as { inner: { api_key: string } };
    expect(outer.inner.api_key).toBe('***redacted***');
  });

  it.each([
    ['Anthropic key', 'token sk-ant-api03-ABCDEFGHIJKLMNOP failed', 'ABCDEFGHIJKLMNOP'],
    ['Shopify token', 'shop rejected shpat_1a2b3c4d5e6f7g8h', 'shpat_1a2b3c4d'],
    ['Runway key', 'auth key-ABCDEFGHIJKLMNOPQRSTUV bad', 'key-ABCDEFGHIJKLMNOP'],
    ['Meta token', 'meta said EAABwzLixnjYBOZZZZZZZZZZZZZZZZZZ expired', 'EAABwzLixnjYBO'],
    [
      'JWT',
      'bad jwt eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4',
      'SflKxwRJSMeKKF2QT4',
    ],
  ])('redacts a %s appearing in the message text', async (_label, message, secret) => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').warn(message);
    expect(String(lastRecord().msg)).not.toContain(secret);
  });

  it('redacts a password inside a connection string but keeps the host', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').warn('cannot connect to postgresql://user:supersecret@db.example.com:5432/app');
    const msg = String(lastRecord().msg);
    expect(msg).not.toContain('supersecret');
    // The host must survive, or the message stops being diagnostic.
    expect(msg).toContain('db.example.com:5432');
  });

  it('redacts secrets inside an Error message', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    logger('svc').error('failed', new Error('bad token sk-ant-api03-ZYXWVUTSRQPONMLK'));
    const r = lastRecord();
    expect(JSON.stringify(r)).not.toContain('ZYXWVUTSRQPONMLK');
  });

  it('leaves ordinary messages byte-for-byte unchanged', async () => {
    // The regression guard. A previous bug spliced the whole message into itself.
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    const message = 'applied 33 migrations in 412ms for org 9f3c (0 skipped)';
    logger('svc').info(message);
    expect(lastRecord().msg).toBe(message);
  });

  it('does not duplicate or grow a message containing a secret', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    const message = 'token sk-ant-api03-ABCDEFGHIJKLMNOP failed';
    logger('svc').warn(message);
    const msg = String(lastRecord().msg);
    expect(msg.length).toBeLessThan(message.length + 20);
    expect(msg.match(/failed/g)).toHaveLength(1);
  });

  it('truncates deeply nested structures instead of recursing without bound', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'json' });
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => logger('svc').info('deep', deep)).not.toThrow();
    expect(JSON.stringify(lastRecord())).toContain('truncated');
  });
});

describe('pretty output', () => {
  it('keeps the [scope] message shape the codebase used before', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'pretty', LOG_LEVEL: 'debug' });
    logger('strategy').info('queued id=abc');
    expect(captured.at(-1)).toContain('[strategy] queued id=abc');
  });

  it('appends abbreviated context', async () => {
    const { logger, withLogContext } = await loadLogger({ LOG_FORMAT: 'pretty' });
    withLogContext({ requestId: 'abcdef123456', organizationId: 'org-987654321' }, () => {
      logger('svc').info('working');
    });
    const line = captured.at(-1)!;
    expect(line).toContain('req=abcdef12');
    expect(line).toContain('org=org-9876');
  });

  it('still redacts in pretty mode', async () => {
    const { logger } = await loadLogger({ LOG_FORMAT: 'pretty' });
    logger('svc').warn('token sk-ant-api03-ABCDEFGHIJKLMNOP');
    expect(captured.at(-1)).not.toContain('ABCDEFGHIJKLMNOP');
  });
});
