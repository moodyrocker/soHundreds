import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
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

const app = express();
const port = Number(process.env.PORT) || 3001;

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
app.use(express.json());

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

app.use('/api/auth', createAuthRouter());
app.use('/api/organizations', createOrganizationsRouter());

const tenantRoutes = express.Router();
tenantRoutes.use(authMiddleware);
tenantRoutes.use(tenantMiddleware);
tenantRoutes.use('/mcp', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const org = req.header('X-Organization-Id') ?? '-';
    console.log(
      `[mcp] ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms) org=${org}`
    );
  });
  next();
});
tenantRoutes.use('/mcp', createMCPRouter());
tenantRoutes.use('/strategy', createStrategyRouter());
tenantRoutes.use('/business-profile', createBusinessProfileRouter());
tenantRoutes.use('/content-recipes', createContentRecipesRouter());
tenantRoutes.use('/brand-visuals', createBrandVisualsRouter());
tenantRoutes.use('/runway-tests', createRunwayPromptTestsRouter());
tenantRoutes.use('/ad-campaigns', createAdCampaignsRouter());
tenantRoutes.use('/checkup', createCheckupRouter());
tenantRoutes.use('/execution', createExecutionRouter());
app.use('/api', tenantRoutes);

app.use(
  (
    err: Error & { issues?: unknown },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation failed', details: err.issues });
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    if (err instanceof Anthropic.APIError && /MCP server|communicating with MCP/i.test(message)) {
      res.status(502).json({
        error:
          'Remote analytics connector failed. Restart the API container and try again — plans use direct Google Analytics API data.',
      });
      return;
    }

    if (/MCP server|communicating with MCP/i.test(message)) {
      res.status(502).json({
        error:
          'Remote analytics connector failed. Restart the API container and try again.',
      });
      return;
    }

    res.status(500).json({ error: message || 'Internal server error' });
  }
);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  void import('./workers/autopilotCycleWorker.js')
    .then(({ startAutopilotCycleWorker }) => startAutopilotCycleWorker())
    .catch((err) => {
      console.error(
        '[autopilot-cycle] failed to start worker:',
        err instanceof Error ? err.message : err
      );
    });
});
