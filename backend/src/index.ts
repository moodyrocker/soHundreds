// Must precede any import that reads process.env at module scope.
import './lib/loadEnv.js';
import cors from 'cors';
import express from 'express';
import { authMiddleware } from './middleware/auth.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { createAuthRouter } from './routes/auth.js';
import { createMCPRouter } from './routes/mcp.js';
import { createOrganizationsRouter } from './routes/organizations.js';
import { createStrategyRouter } from './routes/strategy.js';
import { createBusinessProfileRouter } from './routes/businessProfile.js';
import { createContentRecipesRouter } from './routes/contentRecipes.js';
import { createBrandVisualsRouter } from './routes/brandVisuals.js';
import { createRunwayPromptTestsRouter } from './routes/runwayPromptTests.js';
import { createAdCampaignsRouter } from './routes/adCampaigns.js';
import { createCheckupRouter } from './routes/checkup.js';
import { createExecutionRouter } from './routes/execution.js';
import { mountAllMcpBridges } from './mcp/mountMcpBridges.js';
import { securityHeaders } from './lib/securityHeaders.js';
import { dbLimiter, memoryLimiter } from './lib/rateLimit.js';
import { attachRequestId, errorHandler } from './lib/errorHandler.js';
import { logger } from './lib/logger.js';

const log = logger('api');

const app = express();
const port = Number(process.env.PORT) || 3001;

// Behind the Next.js proxy (and a load balancer in production), so req.ip must
// come from X-Forwarded-For rather than the socket. Bounded to 1 hop: trusting
// the whole chain would let a client forge its own IP for the auth limiter.
app.set('trust proxy', 1);

// Do not advertise the framework.
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(attachRequestId);

app.use(
  cors({
    origin: [
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      process.env.WEB_ORIGIN,
    ].filter(Boolean) as string[],
    credentials: true,
  })
);

// Bound the body size. express.json() defaults to 100kb, but it was left
// implicit; state it, and allow an override since plan documents and generated
// content can be large.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT?.trim() || '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Meta webhook verification (Instagram/Messenger) — public, no auth. */
app.get('/api/meta/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();

  if (mode === 'subscribe' && token && expected && token === expected && challenge) {
    res.status(200).send(String(challenge));
    return;
  }
  res.status(403).send('Forbidden');
});

app.post('/api/meta/webhook', (_req, res) => {
  res.sendStatus(200);
});

mountAllMcpBridges(app);

// Auth is pre-tenant, so it is limited by IP — the only bucket that can be.
app.use('/api/auth', dbLimiter('auth'), createAuthRouter());
app.use('/api/organizations', createOrganizationsRouter());

const tenantRoutes = express.Router();
tenantRoutes.use(authMiddleware);
tenantRoutes.use(tenantMiddleware);

// General ceiling for everything tenant-scoped. Per-process and approximate;
// the cost-critical buckets below are the ones that must be exact.
tenantRoutes.use(memoryLimiter());

tenantRoutes.use('/mcp', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const org = req.header('X-Organization-Id') ?? '-';
    log.info(
      `${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms) org=${org}`
    );
  });
  next();
});
tenantRoutes.use('/mcp', createMCPRouter());

// Cost-critical buckets, counted in Postgres so the ceiling holds across
// replicas. Applied to whole route groups rather than individual handlers: the
// limit is a spend ceiling, and a GET that happens to sit alongside a Claude
// call is cheap enough that including it costs nothing.
//
// ai_generation — every route group that can reach ClaudeService.
tenantRoutes.use('/strategy', dbLimiter('ai_generation'), createStrategyRouter());
tenantRoutes.use('/checkup', dbLimiter('ai_generation'), createCheckupRouter());
tenantRoutes.use('/business-profile', dbLimiter('ai_generation'), createBusinessProfileRouter());
tenantRoutes.use('/content-recipes', dbLimiter('ai_generation'), createContentRecipesRouter());
tenantRoutes.use('/runway-tests', dbLimiter('ai_generation'), createRunwayPromptTestsRouter());

// paid_ads — creating or pushing campaigns that spend real budget.
tenantRoutes.use('/ad-campaigns', dbLimiter('paid_ads'), createAdCampaignsRouter());

// content_publish — Shopify pages/blogs/SEO, Instagram, Mailchimp, and the
// orchestrator steps that drive them.
tenantRoutes.use('/execution', dbLimiter('content_publish'), createExecutionRouter());
tenantRoutes.use('/brand-visuals', dbLimiter('content_publish'), createBrandVisualsRouter());

app.use('/api', tenantRoutes);

// Sanitises the response and logs full detail against the request id.
// See lib/errorHandler.ts — the previous inline handler returned raw
// Error.message, which leaked SQL fragments and upstream response bodies.
app.use(errorHandler);

app.listen(port, () => {
  log.info(`Server listening on http://localhost:${port}`);

  // The autopilot loop runs in its own process (see workers/autopilotWorkerMain.ts
  // and the `worker` service in docker-compose.yml). The API does NOT start it:
  // API replicas must stay stateless so they can be scaled or rolled without
  // multiplying the number of processes driving the agent.
  //
  // Set AUTOPILOT_CYCLE_WORKER=true to opt in — useful only for a single-process
  // local run with no worker container. Never set it on a scaled API.
  if (process.env.AUTOPILOT_CYCLE_WORKER?.trim().toLowerCase() === 'true') {
    log.warn(
      'AUTOPILOT_CYCLE_WORKER=true — running the agent loop inside the API process. ' +
        'Safe only with a single API replica; use the dedicated worker service otherwise.'
    );
    void import('./workers/autopilotCycleWorker.js')
      .then(({ startAutopilotCycleWorker }) => startAutopilotCycleWorker())
      .catch((err) => {
        log.error(
          'failed to start worker:', err);
      });
  }
});
