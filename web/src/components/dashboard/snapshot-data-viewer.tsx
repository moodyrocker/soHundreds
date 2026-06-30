'use client';

import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import type { SnapshotPreflightLine } from '@/lib/execution';

type Props = {
  line: SnapshotPreflightLine;
  defaultExpanded?: boolean;
  compact?: boolean;
};

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function SnapshotDataViewer({ line, defaultExpanded = true, compact }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const fullText = line.text ?? line.excerpt;

  return (
    <div
      style={{
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface-2, rgba(255,255,255,0.02))',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: expanded && fullText ? 8 : 0,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 13 }}>{line.label}</strong>
        {!line.connected ? (
          <Chip>Not connected</Chip>
        ) : line.loaded ? (
          <Chip variant="success">Data loaded</Chip>
        ) : (
          <Chip variant="warn">No data</Chip>
        )}
        {line.loaded && fullText ? (
          <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            {fullText.length.toLocaleString()} chars
          </span>
        ) : null}
        {line.loaded && fullText ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Button
              variant="ghost"
              type="button"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Hide' : 'Show data'}
            </Button>
            <Button
              variant="ghost"
              type="button"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={async () => {
                await copyText(fullText);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : null}
      </div>

      {line.connected && line.error && !line.loaded ? (
        <p className="auth-error" style={{ margin: 0, fontSize: 12 }}>
          {line.error}
        </p>
      ) : null}

      {!line.connected ? (
        <p className="t-dim" style={{ margin: 0, fontSize: 12 }}>
          Connect in Integrations to include live {line.label} data.
        </p>
      ) : null}

      {expanded && fullText ? (
        <pre
          className="t-mono"
          style={{
            margin: 0,
            fontSize: 11,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-dim)',
            maxHeight: compact ? 200 : 360,
            overflow: 'auto',
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface, rgba(0,0,0,0.15))',
          }}
        >
          {fullText}
        </pre>
      ) : null}

      {line.loaded && fullText && line.excerpt && line.text && line.text.length > line.excerpt.length && !expanded ? (
        <p className="t-dim" style={{ fontSize: 11, margin: '8px 0 0' }}>
          Preview: {line.excerpt.slice(0, 160)}
          {line.excerpt.length > 160 ? '…' : ''}
        </p>
      ) : null}
    </div>
  );
}
