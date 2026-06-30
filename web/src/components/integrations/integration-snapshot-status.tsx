import { Chip } from '@/components/hundres/chip';
import type { SnapshotProbeResult } from '@/lib/mcp';

type Props = {
  probe: SnapshotProbeResult | null | undefined;
  healthLoading: boolean;
  connectionReady: boolean;
};

export function dataHealthChip(
  connectionReady: boolean,
  probe: SnapshotProbeResult | null | undefined,
  healthLoading: boolean
): { variant: 'default' | 'success' | 'warn'; label: string } | null {
  if (!connectionReady) return null;
  if (healthLoading || !probe) {
    return { variant: 'default', label: 'Checking data…' };
  }
  if (probe.dataAvailable) {
    return { variant: 'success', label: 'Data OK' };
  }
  return { variant: 'warn', label: 'Data error' };
}

export function IntegrationSnapshotStatus({ probe, healthLoading, connectionReady }: Props) {
  if (!connectionReady) return null;

  if (healthLoading || !probe) {
    return (
      <p className="auth-hint" style={{ marginTop: 12 }}>
        Verifying that plan generation can load live metrics…
      </p>
    );
  }

  if (probe.dataAvailable) {
    return (
      <p className="auth-hint" style={{ marginTop: 12 }}>
        Data loading OK — new plans will include live metrics from this source.
      </p>
    );
  }

  if (probe.userMessage) {
    return (
      <div style={{ marginTop: 12 }}>
        <p className="auth-error" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Connected, but data could not be loaded: {probe.userMessage}
        </p>
        {probe.errorCode ? (
          <p className="auth-hint" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
            Code: {probe.errorCode}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}

export function IntegrationDataChip({
  probe,
  healthLoading,
  connectionReady,
}: Props) {
  const chip = dataHealthChip(connectionReady, probe, healthLoading);
  if (!chip) return null;
  return <Chip variant={chip.variant}>{chip.label}</Chip>;
}
