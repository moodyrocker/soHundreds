'use client';

import {
  DEV_INTEGRATION_SETUP_HINT,
  showDevIntegrationHints,
} from '@/lib/integration-ui-copy';

type Props = {
  message: string;
  title?: string;
};

/** Friendly “not available” state — no env vars or CLI for end users. */
export function IntegrationUnavailable({ message, title = 'Not available yet' }: Props) {
  return (
    <div
      style={{
        marginTop: 20,
        paddingTop: 20,
        borderTop: '1px solid var(--border)',
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{title}</p>
      <p className="t-dim" style={{ fontSize: 13.5, lineHeight: 1.55, margin: '8px 0 0' }}>
        {message}
      </p>
      {showDevIntegrationHints() ? (
        <p className="auth-hint" style={{ marginTop: 12, lineHeight: 1.5 }}>
          {DEV_INTEGRATION_SETUP_HINT}
        </p>
      ) : null}
    </div>
  );
}
