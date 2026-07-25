#!/usr/bin/env node
/**
 * M7 happy-path verification (M7-1 + M7-8).
 * - Static: new goal redirects to Home, not Thinking-first
 * - Static: Autopilot Home owns execution + week loop APIs
 * - Live (optional): Keylo strategy DB evidence
 *
 * Usage:
 *   node scripts/verify-m7-happy-path.mjs
 *   KEYLO_ORG_ID=... KEYLO_STRATEGY_ID=... node scripts/verify-m7-happy-path.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const KEYLO_ORG = process.env.KEYLO_ORG_ID ?? '6315debd-0ddf-4f43-97dc-0cc05a20db16';
const KEYLO_STRAT = process.env.KEYLO_STRATEGY_ID ?? '9cb389c2-3474-4a5c-ab4b-9c144b728b7b';

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function staticChecks() {
  const genProvider = read('web/src/providers/strategy-generation-provider.tsx');
  const goalForm = read('web/src/components/goal-input/goal-input-form.tsx');
  const dashboard = read('web/src/components/dashboard/dashboard-view.tsx');
  const planView = read('web/src/components/plan/plan-view.tsx');

  const redirectsHome =
    genProvider.includes("router.replace('/')") &&
    genProvider.includes('await createStrategy') &&
    !genProvider.includes("router.replace('/thinking");

  const goalFormUsesStartGeneration =
    goalForm.includes('startGeneration') && !goalForm.includes('/thinking');

  const dashboardRunsWeek =
    dashboard.includes('runWeekExecutions') &&
    dashboard.includes('runContinuousAutopilot') &&
    dashboard.includes('AutopilotActionTable');

  const planNotRequired =
    !dashboard.includes("router.replace(`/plan") &&
    !dashboard.includes("router.push(`/plan") &&
    dashboard.includes('ProgressChartsPanel');

  const planIsSecondary =
    planView.includes('Run agent for week') &&
    dashboard.includes('runWeekExecutions');

  return [
    check('M7-1: createStrategy → router.replace("/") (Home)', redirectsHome, 'strategy-generation-provider.tsx'),
    check('M7-1: Goal form calls startGeneration (no Thinking redirect)', goalFormUsesStartGeneration, 'goal-input-form.tsx'),
    check('M7-8: Home runs week executions + continuous autopilot', dashboardRunsWeek, 'dashboard-view.tsx'),
    check('M7-8: Home does not force navigation to /plan', planNotRequired, 'dashboard-view.tsx'),
    check('M7-8: Execution APIs available on Home (same spine as /plan)', planIsSecondary, 'dashboard + plan-view'),
  ];
}

function liveDbChecks() {
  const script = `
const { query } = require('./dist/database/connection.js');
const ORG = '${KEYLO_ORG}';
const STRAT = '${KEYLO_STRAT}';
(async () => {
  const strat = await query(
    "SELECT id, status, goal_status, current_week, goal, created_at FROM strategies WHERE id = $1 AND organization_id = $2",
    [STRAT, ORG]
  );
  const executions = await query(
    "SELECT COUNT(*)::int AS n FROM action_executions WHERE strategy_id = $1 AND status = 'executed'",
    [STRAT]
  );
  const outcomes = await query(
    "SELECT week_number, status, goal_met FROM goal_week_outcomes WHERE strategy_id = $1 ORDER BY week_number",
    [STRAT]
  );
  const audit = await query(
    "SELECT event_type FROM audit_log WHERE strategy_id = $1 AND event_type IN ('goal_progress_check','week_outcome_recorded') ORDER BY created_at DESC LIMIT 3",
    [STRAT]
  );
  console.log(JSON.stringify({
    strategy: strat.rows[0] ?? null,
    executedCount: executions.rows[0]?.n ?? 0,
    outcomes: outcomes.rows,
    recentGoalEvents: audit.rows.map((r) => r.event_type),
  }));
})().catch((e) => { console.error(e.message); process.exit(1); });
`;

  const res = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', script], {
    cwd: root,
    encoding: 'utf8',
  });

  if (res.status !== 0) {
    return [
      check('Live: Keylo strategy exists', false, res.stderr?.trim() || res.stdout?.trim() || 'docker exec failed'),
    ];
  }

  let data;
  try {
    data = JSON.parse(res.stdout.trim());
  } catch {
    return [check('Live: parse DB response', false, res.stdout.slice(0, 200))];
  }

  const s = data.strategy;
  const checks = [];

  checks.push(
    check(
      'Live: Keylo strategy created and active',
      Boolean(s?.id && s.status === 'active'),
      s ? `week ${s.current_week}, goal_status=${s.goal_status}` : 'not found'
    )
  );

  checks.push(
    check(
      'Live: Executions ran without /plan (API spine)',
      data.executedCount > 0,
      `${data.executedCount} executed action(s)`
    )
  );

  checks.push(
    check(
      'Live: Goal loop recorded (metric check + outcomes)',
      data.recentGoalEvents.includes('goal_progress_check') && data.outcomes.length > 0,
      `events: ${data.recentGoalEvents.join(', ')}; outcomes: ${data.outcomes.length}`
    )
  );

  checks.push(
    check(
      'Live: Week advanced OR goal met (M7-7)',
      (s?.current_week ?? 0) > 1 || s?.goal_status === 'met',
      `week ${s?.current_week}, goal_status=${s?.goal_status}`
    )
  );

  return checks;
}

const staticResults = staticChecks();
const liveResults = liveDbChecks();
const all = [...staticResults, ...liveResults];
const passed = all.filter((r) => r.ok).length;

console.log('\nM7 Happy path verification\n');
for (const r of all) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log(`       ${r.detail}\n`);
}
console.log(`Score: ${passed} / ${all.length}`);

if (passed < all.length) process.exit(1);
