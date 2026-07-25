'use client';

import { useEffect } from 'react';
import { ActionDeliverableCard } from '@/components/dashboard/action-deliverable-card';
import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import type { ExecutionRecord } from '@/lib/execution';
import { getExecutionOutcomeLink } from '@/lib/execution-outcome';
import { sanitizeAgentCopy } from '@/lib/plain-language';
import type { CycleDecision, ReevaluationFlow } from '@/lib/cycle-overview';
import type { PlanAction } from '@/lib/plan-types';

type ReasoningItem = {
  id: string;
  step: string;
  status: string;
  detail: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  action?: PlanAction | null;
  channel?: string;
  statusLabel: string;
  statusVariant: 'success' | 'warn' | 'accent' | 'default';
  execution?: ExecutionRecord | null;
  pending?: boolean;
  error?: string | null;
  routingReasoning?: string | null;
  aiReasoning?: string | null;
  reasoningTrail?: ReasoningItem[];
  reevaluation?: ReevaluationFlow | null;
  decisions?: CycleDecision[];
  onApprove?: () => void;
  approving?: boolean;
  onConfirm?: () => void;
  confirming?: boolean;
  needsConfirm?: boolean;
};

function stepLabel(step: string): string {
  switch (step) {
    case 'executing':
      return 'Working';
    case 'decision':
    case 'action_plan':
      return 'Decision';
    case 'ai_reasoning':
      return 'Reasoning';
    case 'awaiting_human':
      return 'Waiting for you';
    case 'complete':
      return 'Done';
    case 'failed':
      return 'Failed';
    default:
      return 'Step';
  }
}

function reasoningAccent(status: string, step: string): string {
  if (status === 'error' || step === 'failed') return 'var(--danger, #ef4444)';
  if (status === 'running' || step === 'executing') return 'var(--accent, #6366f1)';
  if (status === 'success' || step === 'complete') return 'var(--success, #22c55e)';
  return 'var(--accent, #6366f1)';
}

export function ActionDetailDrawer({
  open,
  onClose,
  action,
  channel,
  statusLabel,
  statusVariant,
  execution,
  pending,
  error,
  routingReasoning,
  aiReasoning,
  reasoningTrail = [],
  reevaluation,
  decisions = [],
  onApprove,
  approving,
  onConfirm,
  confirming,
  needsConfirm,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || (!action && !reevaluation)) return null;

  const outcomeLink = action ? getExecutionOutcomeLink(execution ?? undefined) : null;
  const title = action ? sanitizeAgentCopy(action.title) : reevaluation!.title;

  return (
    <div className="action-drawer-root" role="presentation">
      <button type="button" className="action-drawer-backdrop" aria-label="Close details" onClick={onClose} />
      <aside className="action-drawer-panel" role="dialog" aria-modal aria-labelledby="action-drawer-title">
        <header className="action-drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <Chip variant={statusVariant}>{statusLabel}</Chip>
              {channel ? (
                <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                  {channel}
                </span>
              ) : null}
            </div>
            <h2 id="action-drawer-title" className="h-lg" style={{ margin: 0, lineHeight: 1.3 }}>
              {title}
            </h2>
          </div>
          <button type="button" className="btn btn-ghost action-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="action-drawer-body">
          {reevaluation ? (
            <>
              <p className="t-dim" style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
                {reevaluation.subtitle}
              </p>
              {reevaluation.assessment ? (
                <div style={{ marginBottom: 20 }}>
                  <div className="h-eyebrow" style={{ marginBottom: 8 }}>
                    Assessment
                  </div>
                  <p className="t-dim" style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                    {reevaluation.assessment}
                  </p>
                </div>
              ) : null}
              {reevaluation.nextRotation ? (
                <div style={{ marginBottom: 20 }}>
                  <div className="h-eyebrow" style={{ marginBottom: 8 }}>
                    Next rotation
                  </div>
                  <p className="t-dim" style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                    {reevaluation.nextRotation}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {action ? (
            <>
              {needsConfirm ? (
                <div
                  style={{
                    padding: '12px 14px',
                    marginBottom: 16,
                    borderRadius: 8,
                    border: '1px solid rgba(234, 179, 8, 0.35)',
                    background: 'rgba(234, 179, 8, 0.06)',
                  }}
                >
                  <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.5 }}>
                    This ad needs your approval before the agent continues.
                  </p>
                  {onConfirm ? (
                    <Button variant="primary" type="button" disabled={confirming} onClick={onConfirm}>
                      {confirming ? 'Continuing…' : 'Approve & continue'}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {outcomeLink ? (
                <a
                  href={outcomeLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{ fontSize: 13, marginBottom: 16, display: 'inline-flex' }}
                >
                  {outcomeLink.label} →
                </a>
              ) : null}

              <ActionDeliverableCard
                embedded
                title={action.title}
                channel={channel ?? ''}
                why={action.why}
                outcome={action.outcome}
                kpi={action.kpi}
                execution={execution ?? null}
                pending={pending}
                error={error ?? null}
                routingReasoning={routingReasoning}
                aiReasoning={aiReasoning}
                onApprove={onApprove}
                approving={approving}
              />
            </>
          ) : null}

          {(decisions.length > 0 || reasoningTrail.length > 0) ? (
            <div style={{ marginTop: action || reevaluation ? 4 : 0 }}>
              <div className="h-eyebrow" style={{ marginBottom: 10 }}>
                {reevaluation ? 'Decision making' : 'What the agent did'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {decisions.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      borderLeft: '3px solid var(--border)',
                      paddingLeft: 12,
                      paddingTop: 4,
                      paddingBottom: 4,
                    }}
                  >
                    <span
                      className="t-mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.05em',
                        color: 'var(--text-mute)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {d.label}
                    </span>
                    <p className="t-dim" style={{ fontSize: 13, margin: '4px 0 0', lineHeight: 1.55 }}>
                      {d.summary}
                    </p>
                  </div>
                ))}
                {reasoningTrail.map((item) => {
                  const accent = reasoningAccent(item.status, item.step);
                  return (
                    <div
                      key={item.id}
                      style={{
                        borderLeft: `3px solid ${accent}`,
                        paddingLeft: 12,
                        paddingTop: 4,
                        paddingBottom: 4,
                      }}
                    >
                      <span
                        className="t-mono"
                        style={{
                          fontSize: 10,
                          letterSpacing: '0.05em',
                          color: accent,
                          textTransform: 'uppercase',
                        }}
                      >
                        {stepLabel(item.step)}
                      </span>
                      <p className="t-dim" style={{ fontSize: 13, margin: '4px 0 0', lineHeight: 1.55 }}>
                        {sanitizeAgentCopy(item.detail)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
