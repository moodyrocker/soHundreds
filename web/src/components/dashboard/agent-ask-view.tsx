'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AgentChatPanel } from '@/components/dashboard/agent-chat-panel';
import { Card } from '@/components/hundres/card';
import { Icon } from '@/components/hundres/icon';
import { getActiveStrategy } from '@/lib/strategy';
import { useAuth } from '@/providers/auth-provider';

export function AgentAskView() {
  const { accessToken, activeOrganization } = useAuth();
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoading(true);
    try {
      const { strategy } = await getActiveStrategy(accessToken, activeOrganization.id);
      setStrategyId(strategy?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="dash-greeting" style={{ marginBottom: 20 }}>
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Ask the agent
          </div>
          <h1 className="h-display">Chat with the agent</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
            Have a conversation — the agent remembers what you said, reads your tone, and asks
            follow-up questions when needed before publishing anything.
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <p className="t-dim" style={{ margin: 0 }}>Loading…</p>
        </Card>
      ) : strategyId && accessToken && activeOrganization ? (
        <AgentChatPanel
          strategyId={strategyId}
          accessToken={accessToken}
          organizationId={activeOrganization.id}
          hideHeader
        />
      ) : (
        <Card>
          <p className="t-dim" style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5 }}>
            Set a goal first so the agent knows your business context.
          </p>
          <Link href="/new" className="btn btn-primary">
            <Icon name="sparkle" style={{ width: 14, height: 14 }} />
            Set a goal
          </Link>
        </Card>
      )}
    </>
  );
}
