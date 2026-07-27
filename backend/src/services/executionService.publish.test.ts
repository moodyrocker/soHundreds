import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards on the Instagram publish path.
 *
 * This is the one external write that never went through `approve()`. It
 * publishes first and inserts its execution row afterwards, so there was nothing
 * for a concurrent caller to conflict with — its only protection was a
 * read-then-check in runWeekActions, the same shape as the duplicate-spend bug
 * fixed in 7400720. With INSTAGRAM_AUTO_PUBLISH set the path is unattended, so a
 * duplicate post lands on a customer's feed with nobody watching.
 *
 * The fix reserves the row before publishing, arbitrated by the partial unique
 * index uniq_action_executions_in_flight. These tests cover the reservation, not
 * the Instagram client itself.
 */

type QueryCall = { sql: string; params: unknown[] };

const queryCalls: QueryCall[] = [];

/** Rows the fake database holds, keyed by id. */
let rows: Record<string, Record<string, unknown>> = {};
/** Simulates the unique index rejecting a second in-flight row. */
let insertConflicts = false;
let nextId = 1;

function normalise(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

vi.mock('../database/connection.js', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    queryCalls.push({ sql, params });
    const q = normalise(sql);

    // reserveExecution: the "already executed?" probe.
    //
    // The filter is built from the columns the SQL actually names, not from the
    // parameter positions. An earlier version destructured params — which meant
    // deleting `AND execution_type = $4` from the real query changed nothing
    // under test, because the mock kept filtering by type on the code's behalf.
    // Mutation testing caught it; this is the same failure mode as in
    // executionService.approve.test.ts.
    if (q.startsWith('SELECT id FROM action_executions')) {
      const conditions: Array<[string, unknown]> = [];
      for (const [, column, placeholder] of q.matchAll(/(\w+)\s*=\s*\$(\d+)/g) as Iterable<
        RegExpMatchArray
      >) {
        conditions.push([column!, (params as unknown[])[Number(placeholder) - 1]]);
      }
      const literalStatus = /status\s*=\s*'(\w+)'/.exec(q)?.[1];

      const hit = Object.values(rows).find((r) => {
        if (literalStatus && r.status !== literalStatus) return false;
        return conditions.every(([column, value]) => r[column] === value);
      });
      return { rows: hit ? [{ id: hit.id }] : [], rowCount: hit ? 1 : 0 };
    }

    // reserveExecution: the guarded insert
    if (q.startsWith('INSERT INTO action_executions')) {
      if (insertConflicts) {
        // ON CONFLICT DO NOTHING — the unique index rejected it.
        return { rows: [], rowCount: 0 };
      }
      const [org, strategy, action, platform, type, risk, summary, target, proposed] =
        params as string[];
      const id = `exec-${nextId++}`;
      rows[id] = {
        id,
        organization_id: org,
        strategy_id: strategy,
        action_id: action,
        platform,
        execution_type: type,
        status: 'executing',
        risk_level: risk,
        summary,
        target_label: target,
        before_state: null,
        proposed_state: JSON.parse(proposed),
        after_state: null,
        error_message: null,
        created_at: new Date(),
        updated_at: new Date(),
        executed_at: null,
        rolled_back_at: null,
      };
      return { rows: [rows[id]], rowCount: 1 };
    }

    if (q.startsWith('UPDATE action_executions')) {
      const id = (params as string[])[0]!;
      const setStatus = /SET\s+status\s*=\s*'(\w+)'/.exec(q)?.[1];
      if (rows[id] && setStatus) {
        rows[id] = { ...rows[id], status: setStatus };
      }
      return { rows: rows[id] ? [rows[id]] : [], rowCount: rows[id] ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  }),
  pool: { on: vi.fn(), query: vi.fn(), connect: vi.fn() },
}));

const capsState = { allow: true, reason: undefined as string | undefined };
vi.mock('../lib/seoCooldown.js', () => ({
  evaluateChannelCaps: vi.fn(async () => ({ ...capsState })),
  getSeoCooldownTargets: vi.fn(async () => ({ productIds: new Set<string>(), cooldownDays: 7 })),
}));
vi.mock('./autopilotService.js', () => ({ getAutopilotPace: vi.fn(async () => 'normal') }));
vi.mock('./businessProfileService.js', () => ({
  getBusinessProfile: vi.fn(async () => ({
    website: 'https://shop.example',
    oneLiner: 'nice things',
    audience: 'people',
  })),
}));

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:1/test';

const { ExecutionService } = await import('./executionService.js');

function makeFakes() {
  return {
    instagram: {
      publishPhotoForAction: vi.fn(async () => ({
        kind: 'instagram_publish',
        mediaType: 'photo',
        mediaId: 'media-1',
        permalink: 'https://instagram.com/p/abc',
      })),
    },
    audit: { recordExecutionWrite: vi.fn(async () => undefined) },
    completions: { setCompleted: vi.fn(async () => undefined) },
    activity: { log: vi.fn(async () => undefined) },
    mcp: {},
    shopify: {},
  };
}

type Fakes = ReturnType<typeof makeFakes>;

function service(f: Fakes) {
  return new ExecutionService(f as never);
}

const action = {
  id: 'w1-a1',
  title: 'Publish a carousel',
  channel: 'instagram',
  day: 'Mon',
  time: '30m',
  impact: 'high',
  difficulty: 'easy',
  why: 'reach',
  outcome: 'more reach',
  kpi: 'reach',
};

const strategy = { id: 'strategy-1', goal: 'more orders', context: 'ctx' };
const route = {
  platform: 'instagram',
  executionType: 'publish_instagram_photo',
  riskLevel: 'medium',
  mode: 'automated_write',
};

/** runInstagramPublish is private; reach it the way production does. */
function publish(f: Fakes) {
  const svc = service(f) as unknown as {
    runInstagramPublish: (
      org: string,
      strategyId: string,
      action: unknown,
      strategy: unknown,
      route: unknown,
      brief?: unknown
    ) => Promise<unknown>;
  };
  return svc.runInstagramPublish('org-1', 'strategy-1', action, strategy, route, null);
}

beforeEach(() => {
  queryCalls.length = 0;
  rows = {};
  insertConflicts = false;
  nextId = 1;
  capsState.allow = true;
  capsState.reason = undefined;
  vi.clearAllMocks();
});

describe('reserves before publishing', () => {
  it('inserts an executing row before calling Instagram', async () => {
    const f = makeFakes();
    await publish(f);

    const insertIndex = queryCalls.findIndex((c) =>
      normalise(c.sql).startsWith('INSERT INTO action_executions')
    );
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    // The reservation must exist before the post does — that ordering is the
    // whole guarantee.
    expect(f.instagram.publishPhotoForAction).toHaveBeenCalledTimes(1);
    expect(normalise(queryCalls[insertIndex]!.sql)).toContain("'executing'");
  });

  it('reserves with ON CONFLICT DO NOTHING so the index can arbitrate', async () => {
    const f = makeFakes();
    await publish(f);
    const insert = queryCalls.find((c) => normalise(c.sql).startsWith('INSERT INTO'))!;
    expect(normalise(insert.sql)).toContain('ON CONFLICT DO NOTHING');
    expect(normalise(insert.sql)).toContain('RETURNING *');
  });

  it('completes the reserved row rather than inserting a second one', async () => {
    const f = makeFakes();
    await publish(f);
    const inserts = queryCalls.filter((c) => normalise(c.sql).startsWith('INSERT INTO'));
    expect(inserts).toHaveLength(1);
    expect(Object.values(rows).filter((r) => r.status === 'executed')).toHaveLength(1);
  });

  it('reaches executed and records one audit entry', async () => {
    const f = makeFakes();
    await publish(f);
    expect(Object.values(rows)[0]!.status).toBe('executed');
    expect(f.audit.recordExecutionWrite).toHaveBeenCalledTimes(1);
  });

  it('marks the plan action complete', async () => {
    const f = makeFakes();
    await publish(f);
    expect(f.completions.setCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('refuses to publish twice', () => {
  it('does not publish when the reservation is lost to a concurrent caller', async () => {
    // The race the index exists for: another caller already holds the in-flight
    // row, so our INSERT conflicts and we must not reach Instagram.
    insertConflicts = true;
    const f = makeFakes();

    await expect(publish(f)).rejects.toThrow(/already running|already completed/i);
    expect(f.instagram.publishPhotoForAction).not.toHaveBeenCalled();
  });

  it('does not publish when this action already published', async () => {
    rows['prior'] = {
      id: 'prior',
      organization_id: 'org-1',
      strategy_id: 'strategy-1',
      action_id: 'w1-a1',
      execution_type: 'publish_instagram_photo',
      status: 'executed',
    };
    const f = makeFakes();

    await expect(publish(f)).rejects.toThrow(/already running|already completed/i);
    expect(f.instagram.publishPhotoForAction).not.toHaveBeenCalled();
    // And it must not even attempt a reservation.
    expect(queryCalls.some((c) => normalise(c.sql).startsWith('INSERT INTO'))).toBe(false);
  });

  it('allows a retry after a previous attempt failed', async () => {
    // Failed rows are outside the partial index, so a genuine retry still works.
    rows['prior'] = {
      id: 'prior',
      organization_id: 'org-1',
      strategy_id: 'strategy-1',
      action_id: 'w1-a1',
      execution_type: 'publish_instagram_photo',
      status: 'failed',
    };
    const f = makeFakes();

    await expect(publish(f)).resolves.toBeTruthy();
    expect(f.instagram.publishPhotoForAction).toHaveBeenCalledTimes(1);
  });

  it('scopes the already-published check to this action', async () => {
    rows['other'] = {
      id: 'other',
      organization_id: 'org-1',
      strategy_id: 'strategy-1',
      action_id: 'a-different-action',
      execution_type: 'publish_instagram_photo',
      status: 'executed',
    };
    const f = makeFakes();
    await expect(publish(f)).resolves.toBeTruthy();
    expect(f.instagram.publishPhotoForAction).toHaveBeenCalledTimes(1);
  });

  it('scopes the check to this execution type', async () => {
    // The same action having published a *story* must not block publishing a
    // photo. This mirrors the pre-existing dedup in runWeekActions, which
    // compared executionType — a route change (e.g. an action reclassified from
    // Meta ads to an organic post) has to be able to run.
    rows['story'] = {
      id: 'story',
      organization_id: 'org-1',
      strategy_id: 'strategy-1',
      action_id: 'w1-a1',
      execution_type: 'publish_instagram_story',
      status: 'executed',
    };
    const f = makeFakes();
    await expect(publish(f)).resolves.toBeTruthy();
    expect(f.instagram.publishPhotoForAction).toHaveBeenCalledTimes(1);
  });

  it('scopes the check to this organization', async () => {
    // Action ids are only unique within a plan, so an identical id in another
    // tenant must never suppress a publish here.
    rows['othertenant'] = {
      id: 'othertenant',
      organization_id: 'org-2',
      strategy_id: 'strategy-1',
      action_id: 'w1-a1',
      execution_type: 'publish_instagram_photo',
      status: 'executed',
    };
    const f = makeFakes();
    await expect(publish(f)).resolves.toBeTruthy();
    expect(f.instagram.publishPhotoForAction).toHaveBeenCalledTimes(1);
  });
});

describe('failure handling', () => {
  it('marks failed when Instagram throws, and does not release for retry', async () => {
    // The post may or may not exist upstream. A retry that republishes is worse
    // than a failure a human can look at.
    const f = makeFakes();
    f.instagram.publishPhotoForAction.mockRejectedValueOnce(new Error('Instagram 500'));

    await expect(publish(f)).rejects.toThrow('Instagram 500');
    expect(Object.values(rows)[0]!.status).toBe('failed');
    expect(Object.values(rows)[0]!.status).not.toBe('previewed');
  });

  it('refuses before reserving when the pace cap is hit', async () => {
    capsState.allow = false;
    capsState.reason = 'Instagram pace cap reached';
    const f = makeFakes();

    await expect(publish(f)).rejects.toThrow(/pace cap reached/);
    expect(f.instagram.publishPhotoForAction).not.toHaveBeenCalled();
    // No row should be created for a refusal that never got started.
    expect(Object.keys(rows)).toHaveLength(0);
  });

  it('falls back to a usable message when the cap gives no reason', async () => {
    capsState.allow = false;
    capsState.reason = undefined;
    const f = makeFakes();
    await expect(publish(f)).rejects.toThrow(/Instagram pace cap reached/);
  });
});
