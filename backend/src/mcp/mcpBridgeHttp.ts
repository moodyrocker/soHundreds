import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpBridgePlatform } from '../lib/mcpBridgeToken.js';
import { verifyMcpBridgeToken } from '../lib/mcpBridgeToken.js';

const transports = new Map<string, StreamableHTTPServerTransport>();

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

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
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

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (transport) transports.set(sid, transport);
          },
        });
        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid) transports.delete(sid);
        };
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: missing or invalid MCP session' },
          id: null,
        });
        return;
      }

      await transport!.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[mcp-bridge:${platform}]`, err);
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
