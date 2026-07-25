/**
 * Autopilot goal-cycle cadence for an agentic platform.
 *
 * Default: wake every 5 minutes; full process at least hourly.
 * Strategies with pending work are always due on the next tick.
 */

export function getAutopilotCycleHours(): number {
  const raw = Number(process.env.AUTOPILOT_CYCLE_HOURS ?? '1');
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(72, Math.floor(raw));
}

/** How often the worker wakes to look for due strategies (minutes). */
export function getAutopilotCycleTickMinutes(): number {
  const raw = Number(process.env.AUTOPILOT_CYCLE_TICK_MINUTES ?? '5');
  if (!Number.isFinite(raw) || raw < 1) return 5;
  return Math.min(60, Math.floor(raw));
}

export function isAutopilotCycleWorkerEnabled(): boolean {
  const v = process.env.AUTOPILOT_CYCLE_WORKER?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}
