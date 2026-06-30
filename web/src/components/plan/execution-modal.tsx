'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import {
  approveExecution,
  isAssistDeliverable,
  isGoogleAdsCampaign,
  isProductSeo,
  isShopifyPage,
  previewExecution,
  rollbackExecution,
  skipExecution,
  type ExecutionMode,
  type ExecutionPreviewResponse,
  type ExecutionRecord,
} from '@/lib/execution';

type PlanActionLite = {
  id: string;
  title: string;
  channel: string;
};

type Props = {
  open: boolean;
  action: PlanActionLite | null;
  strategyId: string;
  existingExecution: ExecutionRecord | null;
  accessToken: string;
  organizationId: string;
  onClose: () => void;
  onUpdated: (execution: ExecutionRecord) => void;
};

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ExecutionModal({
  open,
  action,
  strategyId,
  existingExecution,
  accessToken,
  organizationId,
  onClose,
  onUpdated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'skip' | 'rollback' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExecutionPreviewResponse | null>(null);
  const [mode, setMode] = useState<ExecutionMode | null>(null);
  const [editing, setEditing] = useState(false);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [copied, setCopied] = useState(false);

  const execution = preview?.execution ?? existingExecution;
  const isAssist =
    mode === 'assist' || execution?.executionType === 'assist_deliverable';
  const isShopifyWrite =
    mode === 'automated_write' ||
    execution?.executionType === 'update_product_seo' ||
    execution?.executionType === 'create_shopify_page';
  const isGoogleAdsWrite = execution?.executionType === 'create_google_ads_campaign';
  const isExecuted = execution?.status === 'executed';
  const isRolledBack = execution?.status === 'rolled_back';
  const isSkipped = execution?.status === 'skipped';
  const isTerminal = isRolledBack || isSkipped;

  useEffect(() => {
    if (!open || !action) return;

    setError(null);
    setPreview(null);
    setMode(null);
    setEditing(false);
    setCopied(false);

    if (existingExecution && existingExecution.status !== 'previewed') {
      setMode(
        existingExecution.executionType === 'assist_deliverable' ? 'assist' : 'automated_write'
      );
      if (isProductSeo(existingExecution.proposedState)) {
        setSeoTitle(existingExecution.proposedState.seoTitle);
        setSeoDescription(existingExecution.proposedState.seoDescription);
      }
      return;
    }

    let cancelled = false;
    setLoading(true);

    void previewExecution(accessToken, organizationId, strategyId, action.id)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setMode(result.mode);
        onUpdated(result.execution);
        if (isProductSeo(result.execution.proposedState)) {
          setSeoTitle(result.execution.proposedState.seoTitle);
          setSeoDescription(result.execution.proposedState.seoDescription);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load preview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when modal opens for a new action
  }, [open, action?.id, strategyId, accessToken, organizationId]);

  if (!open || !action) return null;

  const assist =
    execution && isAssistDeliverable(execution.proposedState)
      ? execution.proposedState
      : null;
  const seoBefore =
    execution?.beforeState && isProductSeo(execution.beforeState)
      ? execution.beforeState
      : null;
  const seoProposed =
    execution && isProductSeo(execution.proposedState) ? execution.proposedState : null;
  const pageProposed =
    execution && isShopifyPage(execution.proposedState) ? execution.proposedState : null;
  const googleCampaignProposed =
    execution && isGoogleAdsCampaign(execution.proposedState) ? execution.proposedState : null;

  const onApprove = async () => {
    if (!execution) return;
    setBusy('approve');
    setError(null);
    try {
      const { execution: updated } = await approveExecution(
        accessToken,
        organizationId,
        execution.id,
        editing ? { seoTitle, seoDescription } : undefined
      );
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const onSkip = async () => {
    if (!execution) return;
    setBusy('skip');
    setError(null);
    try {
      const { execution: updated } = await skipExecution(
        accessToken,
        organizationId,
        execution.id
      );
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip failed');
    } finally {
      setBusy(null);
    }
  };

  const onRollback = async () => {
    if (!execution) return;
    setBusy('rollback');
    setError(null);
    try {
      const { execution: updated } = await rollbackExecution(
        accessToken,
        organizationId,
        execution.id
      );
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setBusy(null);
    }
  };

  const onCopyAll = async () => {
    if (!assist) return;
    const extras = Object.entries(assist.extras)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    await copyText(
      [assist.headline, '', assist.primaryCopy, extras ? `\n${extras}` : '', '', assist.pasteInstructions].join('\n')
    );
    setCopied(true);
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        className="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="execution-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 580, width: '100%', padding: '22px 24px', maxHeight: '90vh', overflow: 'auto' }}
      >
        <div style={{ marginBottom: 12 }}>
          <h2 id="execution-modal-title" className="h-display" style={{ fontSize: 20, margin: 0 }}>
            {isAssist && isExecuted
              ? 'Ready to use'
              : isExecuted && isGoogleAdsWrite
                ? 'Created in Google Ads'
                : isGoogleAdsWrite
                  ? 'Review Google Ads campaign'
                  : isExecuted && isShopifyWrite
                ? 'Applied in Shopify'
                : isShopifyWrite
                  ? 'Review Shopify change'
                  : 'Hundres prepared this'}
          </h2>
          <p className="auth-hint" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
            {action.title}
          </p>
        </div>

        {loading ? (
          <p className="auth-sub">Preparing…</p>
        ) : error ? (
          <p className="auth-error">{error}</p>
        ) : execution ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <Chip variant="default">
                {execution.executionType === 'create_google_ads_campaign'
                  ? 'Google Ads · Campaign'
                  : execution.executionType === 'create_shopify_page'
                    ? 'Shopify · Page'
                    : isAssist
                      ? 'AI deliverable'
                      : 'Shopify · SEO'}
              </Chip>
              <Chip variant={execution.riskLevel === 'low' ? 'success' : 'warn'}>
                {execution.riskLevel} risk
              </Chip>
              {isAssist && isExecuted ? <Chip variant="success">Prepared</Chip> : null}
              {isExecuted && (isShopifyWrite || isGoogleAdsWrite) ? <Chip variant="success">Executed</Chip> : null}
              {isSkipped ? <Chip>Skipped</Chip> : null}
              {isRolledBack ? <Chip variant="warn">Rolled back</Chip> : null}
            </div>

            <p className="auth-hint" style={{ margin: '0 0 14px', lineHeight: 1.55 }}>
              {execution.summary}
            </p>

            {preview?.scopeWarning ? (
              <div className="card" style={{ marginBottom: 14, padding: '12px 14px' }}>
                <p className="auth-hint" style={{ margin: 0, lineHeight: 1.5 }}>
                  {preview.scopeWarning}{' '}
                  <Link href="/integrations" style={{ color: 'var(--accent)' }}>
                    Reconnect Shopify
                  </Link>
                </p>
              </div>
            ) : null}

            {assist ? (
              <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
                <div className="card" style={{ padding: '12px 14px' }}>
                  <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
                    {assist.headline}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {assist.primaryCopy}
                  </div>
                </div>
                {Object.keys(assist.extras).length > 0 ? (
                  <div className="card" style={{ padding: '12px 14px', fontSize: 13 }}>
                    {Object.entries(assist.extras).map(([key, value]) => (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                          {key}
                        </span>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div>
                  <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
                    Steps
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                    {assist.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
                <p className="auth-hint" style={{ margin: 0, fontSize: 12 }}>
                  {assist.pasteInstructions}
                </p>
              </div>
            ) : null}

            {googleCampaignProposed && !isTerminal ? (
              <div style={{ marginBottom: 14 }}>
                <div className="card" style={{ padding: '10px 12px', fontSize: 13 }}>
                  <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                    Proposed Search campaign · ${googleCampaignProposed.dailyBudgetUsd}/day (paused)
                  </div>
                  <strong>{googleCampaignProposed.campaignName}</strong>
                  <div style={{ marginTop: 8, color: 'var(--text-mute)', fontSize: 12, lineHeight: 1.5 }}>
                    {googleCampaignProposed.adGroups.length} ad group
                    {googleCampaignProposed.adGroups.length === 1 ? '' : 's'} ·{' '}
                    {googleCampaignProposed.adGroups[0]?.keywords.length ?? 0}+ keywords
                  </div>
                  <p className="auth-hint" style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5 }}>
                    Approve creates this paused in Google Ads. You enable spending in Google Ads when ready.
                  </p>
                </div>
              </div>
            ) : null}

            {isShopifyWrite && pageProposed && !isTerminal ? (
              <div style={{ marginBottom: 14 }}>
                <div className="card" style={{ padding: '10px 12px', fontSize: 13 }}>
                  <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                    Proposed page · /pages/{pageProposed.handle} (draft)
                  </div>
                  <strong>{pageProposed.title}</strong>
                  <div style={{ marginTop: 6, color: 'var(--text-mute)', fontSize: 12 }}>
                    {pageProposed.seoTitle} — {pageProposed.seoDescription}
                  </div>
                  <div
                    style={{ marginTop: 10, fontSize: 12, maxHeight: 200, overflow: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: pageProposed.bodyHtml }}
                  />
                </div>
              </div>
            ) : null}

            {isShopifyWrite && seoProposed && !pageProposed && !isTerminal ? (
              <div style={{ marginBottom: 14 }}>
                {editing ? (
                  <>
                    <textarea
                      className="auth-input"
                      rows={2}
                      value={seoTitle}
                      onChange={(e) => setSeoTitle(e.target.value)}
                      style={{ width: '100%', marginBottom: 10 }}
                    />
                    <textarea
                      className="auth-input"
                      rows={3}
                      value={seoDescription}
                      onChange={(e) => setSeoDescription(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div className="card" style={{ padding: '10px 12px', fontSize: 13 }}>
                      <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>Before</div>
                      {seoBefore?.seoTitle || '(empty)'}
                      <div style={{ marginTop: 6, color: 'var(--text-mute)', fontSize: 12 }}>
                        {seoBefore?.seoDescription || ''}
                      </div>
                    </div>
                    <div className="card" style={{ padding: '10px 12px', fontSize: 13 }}>
                      <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>After (proposed)</div>
                      {seoProposed.seoTitle}
                      <div style={{ marginTop: 6, color: 'var(--text-mute)', fontSize: 12 }}>
                        {seoProposed.seoDescription}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {execution.errorMessage ? (
              <p className="auth-error" style={{ marginBottom: 12 }}>{execution.errorMessage}</p>
            ) : null}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {assist ? (
                <Button variant="primary" type="button" onClick={() => void onCopyAll()}>
                  {copied ? 'Copied' : 'Copy all'}
                </Button>
              ) : null}
              {isGoogleAdsWrite && execution.status === 'previewed' ? (
                <>
                  <Button
                    variant="primary"
                    type="button"
                    disabled={busy !== null || preview?.canExecute === false}
                    onClick={() => void onApprove()}
                  >
                    {busy === 'approve' ? 'Creating…' : 'Create paused in Google Ads'}
                  </Button>
                  <Button variant="ghost" type="button" disabled={busy !== null} onClick={() => void onSkip()}>
                    Skip
                  </Button>
                </>
              ) : null}
              {isShopifyWrite && execution.status === 'previewed' ? (
                <>
                  <Button
                    variant="primary"
                    type="button"
                    disabled={busy !== null || preview?.canExecute === false}
                    onClick={() => void onApprove()}
                  >
                    {busy === 'approve' ? 'Applying…' : pageProposed ? 'Create page' : 'Approve & run'}
                  </Button>
                  <Button variant="ghost" type="button" disabled={busy !== null} onClick={() => setEditing((v) => !v)}>
                    {editing ? 'Preview mode' : 'Edit proposal'}
                  </Button>
                  <Button variant="ghost" type="button" disabled={busy !== null} onClick={() => void onSkip()}>
                    Skip
                  </Button>
                </>
              ) : null}
              {isExecuted && isShopifyWrite && !isRolledBack ? (
                <Button variant="primary" type="button" disabled={busy !== null} onClick={() => void onRollback()}>
                  {busy === 'rollback' ? 'Rolling back…' : 'Rollback'}
                </Button>
              ) : null}
              <Button variant="ghost" type="button" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
