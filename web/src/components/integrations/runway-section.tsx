'use client';

import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import type { IntegrationCapability, MCPStatusResponse, McpServerStatus } from '@/lib/mcp';
import { IntegrationMcpBadge } from '@/components/integrations/integration-mcp-panel';
import { IntegrationUnavailable } from '@/components/integrations/integration-unavailable';
import { IntegrationQuickLink } from '@/components/integrations/integration-quick-link';
import { INTEGRATION_HELP, INTEGRATION_QUICK_LINKS, INTEGRATION_UNAVAILABLE } from '@/lib/integration-ui-copy';

type Props = {
  status: MCPStatusResponse | null;
  capability?: IntegrationCapability;
  loading: boolean;
  mcpLoading: boolean;
  mcpServer?: McpServerStatus | null;
};

export function RunwaySection({
  status,
  capability,
  loading,
  mcpLoading,
  mcpServer,
}: Props) {
  const configured = Boolean(status?.runwayConfigured);
  const mcpReady = Boolean(
    mcpServer?.connectionReady && mcpServer.snapshotOk && mcpServer.bridgeOk
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Runway</div>
            {!loading && (
              <>
                <Chip variant={mcpReady ? 'success' : configured ? 'warn' : 'default'}>
                  {mcpReady ? 'MCP ready' : configured ? 'Checking MCP…' : 'Not configured'}
                </Chip>
                <IntegrationMcpBadge server={mcpServer} compact />
              </>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Realistic AI video for Instagram Reels via MCP server{' '}
            <code style={{ fontSize: 12 }}>runway</code> — text-to-video and image-to-video, then
            chain to Instagram <code style={{ fontSize: 12 }}>publish_reel</code>.
          </p>
          {!loading && configured && (
            <p className="auth-hint" style={{ marginTop: 12 }}>
              {INTEGRATION_HELP.runway}
            </p>
          )}
          {mcpLoading ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Probing Runway MCP…
            </p>
          ) : null}
          {mcpServer?.excerpt ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
              {mcpServer.excerpt}
            </p>
          ) : mcpServer?.error ? (
            <p className="auth-error" style={{ marginTop: 8, fontSize: 12 }}>
              {mcpServer.error}
            </p>
          ) : null}
          {mcpServer?.tools?.length ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
              MCP tools: {mcpServer.tools.map((t) => t.name).join(', ')}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <IntegrationQuickLink
            href={INTEGRATION_QUICK_LINKS.runway.href}
            label={INTEGRATION_QUICK_LINKS.runway.label}
          />
        </div>
      </div>

      {!configured && !loading && (
        <IntegrationUnavailable
          message={capability?.userMessage ?? INTEGRATION_UNAVAILABLE.runway}
        />
      )}
    </Card>
  );
}
