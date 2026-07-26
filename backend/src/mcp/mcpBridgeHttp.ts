import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpBridgePlatform } from '../lib/mcpBridgeToken.js';
import { verifyMcpBridgeToken } from '../lib/mcpBridgeToken.js';
import { logger } from '../lib/logger.js';

const log = logger('mcp-bridge');

/**
 * Live MCP bridge sessions.
 *
 * Sessions are keyed by the id the MCP SDK generates, but each entry also records
 * the organization and platform it was created for. Previously this map held bare
 * transports, and a request carrying an existing `mcp-session-id` was served from
 * it after validating only that the bearer token was *a* valid token for *this
 * platform* — never that it belonged to the org that owned the session:
 *
 *   const verified = verifyMcpBridgeToken(token, platform);  // checks org+platform
 *   if (sessionId && transports.has(sessionId)) {
 *     transport = transports.get(sessionId);                 // verified.organizationId unused
 *   }
 *
 * So a caller holding a valid token for their own org, who learned another org's
 * session id, was handed a transport wired to that other org's MCP server and its
 * decrypted platform credentials. Session ids are v4 UUIDs and never leave the
 * server, so this was not practically exploitable — but the check costs nothing
 * and its absence is the kind of thing that becomes exploitable after an
 * unrelated change (a log leak, an error message, a debug endpoint).
 */
type BridgeSession = {
  transport: StreamableHTTPServerTransport;
  organizationId: string;
  platform: McpBridgePlatform;
  createdAt: number;
  lastUsedAt: number;
};

const sessions = new Map<string, BridgeSession>();

/**
 * Abandoned sessions were only ever removed via `transport.onclose`. A client that
 * disconnected without a clean close leaked its transport, its MCP server, and any
 * credentials they held for the lifetime of the process. Sweep on an interval
 * instead of relying on the client behaving.
 */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSessionSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
    let closed = 0;
    for (const [sid, session] of sessions) {
      if (session.lastUsedAt > cutoff) continue;
      sessions.delete(sid);
      closed++;
      // close() triggers onclose, which is now a no-op for an already-deleted
      // entry — the delete above is what actually frees the reference.
      void Promise.resolve(session.transport.close()).catch(() => {});
    }
    if (closed > 0) {
      log.info(`swept ${closed} idle session(s); ${sessions.size} live`);
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/** Exposed for tests and diagnostics. */
export function mcpBridgeSessionCount(): number {
  return sessions.size;
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

export function mountOrgMcpBridge(
  app: Express,
  routePath: string,
  platform: McpBridgePlatform,
  createServer: (organizationId: string) => Promise<McpServer | null>
): void {
  startSessionSweep();

  app.all(routePath, async (req: Request, res: Response) => {
    try {
      const token = extractBearer(req);
      if (!token) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized: missing MCP bridge token' },
          id: null,
        });
        return;
      }

      const verified = verifyMcpBridgeToken(token, platform);
      if (!verified) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Unauthorized: invalid or expired MCP bridge token',
          },
          id: null,
        });
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (existing) {
        // The session must belong to the org and platform named in the token.
        // Anything else is a caller reaching for a session that is not theirs.
        if (
          existing.organizationId !== verified.organizationId ||
          existing.platform !== verified.platform
        ) {
          log.warn(
            `${platform}: rejected cross-tenant session reuse — ` +
              `token org=${verified.organizationId} attempted session owned by ` +
              `org=${existing.organizationId} (platform ${existing.platform})`
          );
          res.status(403).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Forbidden: session does not belong to this workspace',
            },
            id: null,
          });
          return;
        }

        existing.lastUsedAt = Date.now();
        transport = existing.transport;
      } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
        const server = await createServer(verified.organizationId);
        if (!server) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32002,
              message: `${platform} not connected for this workspace`,
            },
            id: null,
          });
          return;
        }

        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            const now = Date.now();
            sessions.set(sid, {
              transport: created,
              organizationId: verified.organizationId,
              platform: verified.platform,
              createdAt: now,
              lastUsedAt: now,
            });
          },
        });
        created.onclose = () => {
          const sid = created.sessionId;
          if (sid) sessions.delete(sid);
        };
        await server.connect(created);
        transport = created;
      } else {
        // A session id that is not in the map lands here. Distinguish it from a
        // genuinely malformed request so an expired session is diagnosable.
        res.status(sessionId ? 404 : 400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: sessionId
              ? 'Session not found or expired — re-initialize'
              : 'Bad Request: missing or invalid MCP session',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error(`${platform}: `, err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });
}
