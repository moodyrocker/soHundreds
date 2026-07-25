'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Button } from '@/components/hundres/button';
import type { IntegrationCapability, MCPStatusResponse, McpServerStatus } from '@/lib/mcp';
import {
  connectMailchimp,
  disconnectPlatform,
  listMailchimpAudiences,
  setMailchimpAudience,
} from '@/lib/mcp';
import { IntegrationMcpBadge } from '@/components/integrations/integration-mcp-panel';
import { IntegrationQuickLink } from '@/components/integrations/integration-quick-link';
import { INTEGRATION_HELP, INTEGRATION_QUICK_LINKS } from '@/lib/integration-ui-copy';
import { useAuth } from '@/providers/auth-provider';

type Props = {
  status: MCPStatusResponse | null;
  capability?: IntegrationCapability;
  loading: boolean;
  mcpLoading: boolean;
  mcpServer?: McpServerStatus | null;
  onRefresh: () => void;
};

export function MailchimpSection({
  status,
  capability,
  loading,
  mcpLoading,
  mcpServer,
  onRefresh,
}: Props) {
  const { accessToken, activeOrganization } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<
    Array<{ id: string; name: string; memberCount: number }>
  >([]);

  const row = status?.connected.find((c) => c.platform === 'mailchimp');
  const connected = Boolean(row);
  const ready = Boolean(row?.ready || status?.hasMailchimp);
  const mcpReady = Boolean(
    mcpServer?.connectionReady && mcpServer.snapshotOk && mcpServer.bridgeOk
  );

  useEffect(() => {
    if (!accessToken || !activeOrganization?.id || !connected) {
      setAudiences([]);
      return;
    }
    let cancelled = false;
    void listMailchimpAudiences(accessToken, activeOrganization.id)
      .then((res) => {
        if (!cancelled) setAudiences(res.audiences);
      })
      .catch(() => {
        if (!cancelled) setAudiences([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, activeOrganization?.id, connected, row?.mailchimpListId]);

  const connect = async () => {
    if (!accessToken || !activeOrganization?.id || !apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await connectMailchimp(accessToken, activeOrganization.id, apiKey.trim());
      setApiKey('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Mailchimp');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!accessToken || !activeOrganization?.id) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectPlatform(accessToken, activeOrganization.id, 'mailchimp');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  };

  const selectAudience = async (listId: string, listName: string) => {
    if (!accessToken || !activeOrganization?.id) return;
    setBusy(true);
    setError(null);
    try {
      await setMailchimpAudience(accessToken, activeOrganization.id, listId, listName);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set audience');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Mailchimp</div>
            {!loading && (
              <>
                <Chip variant={mcpReady ? 'success' : ready ? 'warn' : connected ? 'warn' : 'default'}>
                  {mcpReady
                    ? 'MCP ready'
                    : ready
                      ? 'Checking MCP…'
                      : connected
                        ? 'Pick an audience'
                        : 'Not connected'}
                </Chip>
                <IntegrationMcpBadge server={mcpServer} compact />
              </>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Audiences and email campaign drafts via MCP server{' '}
            <code style={{ fontSize: 12 }}>mailchimp</code> — win-back sequences and list-building.
            Hundres creates drafts only; you send from Mailchimp.
          </p>
          {!loading && (
            <p className="auth-hint" style={{ marginTop: 12 }}>
              {INTEGRATION_HELP.mailchimp}
            </p>
          )}
          {!loading && connected && row?.mailchimpAccountName && (
            <p className="auth-hint" style={{ marginTop: 8 }}>
              Connected · {row.mailchimpAccountName}
              {row.mailchimpListName ? ` · Audience: ${row.mailchimpListName}` : ''}
            </p>
          )}
          {mcpLoading ? (
            <p className="auth-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Probing Mailchimp MCP…
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

          {!loading && !connected && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
              <label className="auth-hint" style={{ fontSize: 12 }}>
                API key (includes datacenter, e.g. xxxxx-us21)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us21"
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                }}
              />
            </div>
          )}

          {!loading && connected && audiences.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <label className="auth-hint" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Default audience for drafts
              </label>
              <select
                value={row?.mailchimpListId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const hit = audiences.find((a) => a.id === id);
                  if (hit) void selectAudience(hit.id, hit.name);
                }}
                disabled={busy}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                  maxWidth: 360,
                }}
              >
                <option value="" disabled>
                  Select audience…
                </option>
                {audiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.memberCount} members)
                  </option>
                ))}
              </select>
            </div>
          )}

          {error ? (
            <p className="auth-error" style={{ marginTop: 10, fontSize: 12 }}>
              {error}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!connected && (
            <Button onClick={() => void connect()} disabled={busy || !apiKey.trim()}>
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          )}
          {connected && (
            <Button variant="ghost" onClick={() => void disconnect()} disabled={busy}>
              Disconnect
            </Button>
          )}
          <IntegrationQuickLink
            href={INTEGRATION_QUICK_LINKS.mailchimp.href}
            label={INTEGRATION_QUICK_LINKS.mailchimp.label}
          />
        </div>
      </div>
      {capability?.userMessage ? (
        <p className="auth-hint" style={{ marginTop: 12, fontSize: 12 }}>
          {capability.userMessage}
        </p>
      ) : null}
    </Card>
  );
}
