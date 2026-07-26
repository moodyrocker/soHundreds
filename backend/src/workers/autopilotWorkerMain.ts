// Must precede any import that reads process.env at module scope.
import '../lib/loadEnv.js';
import { pool } from '../database/connection.js';
import { INSTANCE_ID } from '../lib/workerIdentity.js';
import {
  startAutopilotCycleWorker,
  stopAutopilotCycleWorker,
} from './autopilotCycleWorker.js';

/**
 * Dedicated entrypoint for the autopilot cycle worker.
 *
 * Why this is a separate process from the API:
 *
 *   Previously the worker was started from inside app.listen() in index.ts, so
 *   agent work shared an event loop, memory and lifecycle with HTTP request
 *   handling. Three consequences:
 *
 *   1. Long cycles (multiple Claude calls plus external API work — Runway video
 *      alone runs 10-15 minutes) competed with request latency.
 *   2. Scaling API capacity meant scaling the number of things running the
 *      autopilot loop, which is exactly the duplicate-execution hazard that
 *      atomic claiming now guards against. Separating them means API replicas
 *      are stateless and freely scalable.
 *   3. A deploy or OOM kill during a cycle left executions mid-flight with no
 *      owner. The claim reaper handles that now, but keeping agent work out of
 *      the process that gets recycled on every deploy makes it far rarer.
 *
 * Runs the same image as the API with a different command — see the `worker`
 * service in docker-compose.yml.
 */

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[autopilot-worker] ${signal} received — shutting down`);

  // Releases claims held by this instance so a rolling deploy does not leave
  // strategies parked for the full stale window. In-flight cycles finish on
  // their own; a hard kill is covered by the reaper.
  await stopAutopilotCycleWorker();

  try {
    await pool.end();
  } catch (err) {
    console.error(
      '[autopilot-worker] error closing pool:',
      err instanceof Error ? err.message : err
    );
  }

  console.log('[autopilot-worker] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[autopilot-worker] unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[autopilot-worker] uncaught exception:', err);
  // Exit and let the container restart policy give us a clean process. Claims
  // held by this instance are recovered by the reaper on the next tick.
  process.exit(1);
});

console.log(`[autopilot-worker] starting — instance ${INSTANCE_ID}`);

// The worker process exists solely to run the loop, so ignore
// AUTOPILOT_CYCLE_WORKER here — that flag is what keeps the API from running it.
process.env.AUTOPILOT_CYCLE_WORKER = 'true';
startAutopilotCycleWorker();

// The tick timer is unref'd (so it cannot hold the API process open), which
// means this process needs something else to keep the event loop alive.
setInterval(() => {
  /* keepalive */
}, 60_000);
