'use client';

import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';

type Props = {
  isConnected: boolean;
  canConnect: boolean;
  loading?: boolean;
  connecting?: boolean;
  disconnecting?: boolean;
  connectLabel: string;
  onConnect: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
};

export function IntegrationOAuthActions({
  isConnected,
  canConnect,
  loading,
  connecting,
  disconnecting,
  connectLabel,
  onConnect,
  onReconnect,
  onDisconnect,
}: Props) {
  const busy = connecting || disconnecting;

  if (isConnected) {
    return (
      <>
        {canConnect ? (
          <Button variant="default" type="button" disabled={busy} onClick={onReconnect}>
            {connecting ? 'Opening…' : 'Reconnect'}
          </Button>
        ) : null}
        <Button variant="ghost" type="button" disabled={busy} onClick={onDisconnect}>
          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </>
    );
  }

  if (canConnect) {
    return (
      <Button variant="primary" type="button" disabled={connecting} onClick={onConnect}>
        {connectLabel}
        <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
      </Button>
    );
  }

  if (!loading) {
    return <Chip variant="default">Unavailable</Chip>;
  }

  return null;
}
