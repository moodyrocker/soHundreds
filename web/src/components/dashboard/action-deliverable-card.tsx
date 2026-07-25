'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Chip } from '@/components/hundres/chip';
import {
  isAssistDeliverable,
  isGoogleAdsCampaign,
  isInstagramPublish,
  isMailchimpSequence,
  isMetaAdsCampaign,
  isProductSeo,
  isShopifyBlogArticle,
  isShopifyPage,
  formatAdBudget,
  extractExecutionReasoning,
  type ExecutionRecord,
} from '@/lib/execution';
import { googleAdsConsoleUrl, metaAdsConsoleUrl } from '@/lib/integration-ui-copy';
import {
  advertPlanExtraLabel,
  formatAdvertPlanForCopy,
  isAdvertPlanAction,
  orderedAdvertPlanExtras,
} from '@/lib/advert-plan';
import { ReasoningBlock } from '@/components/dashboard/reasoning-block';

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

type Props = {
  title: string;
  channel: string;
  why?: string;
  outcome?: string;
  kpi?: string;
  execution: ExecutionRecord | null;
  pending?: boolean;
  error?: string | null;
  routingReasoning?: string | null;
  aiReasoning?: string | null;
  scopeWarning?: string | null;
  /** Inline under action summary — no outer card or duplicate header. */
  embedded?: boolean;
  onRunAction?: () => void;
  runningAction?: boolean;
  onPrepare?: () => void;
  preparing?: boolean;
  onRestart?: () => void;
  restarting?: boolean;
  onApprove?: () => void;
  approving?: boolean;
  canExecute?: boolean;
};

function assistCopyText(execution: ExecutionRecord, channel: string): string | null {
  const payload = execution.proposedState;
  if (!isAssistDeliverable(payload)) return null;
  if (isAdvertPlanAction(channel, execution)) {
    return formatAdvertPlanForCopy(payload);
  }
  const extras = Object.entries(payload.extras)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return [
    payload.headline,
    '',
    payload.primaryCopy,
    extras ? `\n${extras}` : '',
    '',
    payload.pasteInstructions,
  ].join('\n');
}

export function ActionDeliverableCard({
  title,
  channel,
  why,
  outcome,
  kpi,
  execution,
  pending,
  error,
  routingReasoning,
  aiReasoning,
  scopeWarning,
  embedded,
  onRunAction,
  runningAction,
  onPrepare,
  preparing,
  onRestart,
  restarting,
  onApprove,
  approving,
  canExecute = true,
}: Props) {
  const isRunning = runningAction || preparing || restarting || pending;
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [whyOpen, setWhyOpen] = useState(false);

  const status = pending
    ? 'running'
    : error
      ? 'failed'
      : !execution
        ? 'waiting'
        : execution.status === 'executed'
          ? 'ready'
          : execution.status === 'previewed'
            ? 'review'
            : execution.status;

  const assist =
    execution && isAssistDeliverable(execution.proposedState) ? execution.proposedState : null;
  const seo =
    execution && isProductSeo(execution.proposedState) ? execution.proposedState : null;
  const page =
    execution && isShopifyPage(execution.proposedState) ? execution.proposedState : null;
  const blogArticle =
    execution && isShopifyBlogArticle(execution.proposedState)
      ? execution.proposedState
      : null;
  const igPublish =
    execution && isInstagramPublish(execution.proposedState) ? execution.proposedState : null;
  const googleCampaign =
    execution && isGoogleAdsCampaign(execution.proposedState)
      ? execution.proposedState
      : null;
  const metaCampaign =
    execution && isMetaAdsCampaign(execution.proposedState)
      ? execution.proposedState
      : null;
  const mailchimpSequence =
    execution && isMailchimpSequence(execution.proposedState)
      ? execution.proposedState
      : null;
  const isAdvertPlan = isAdvertPlanAction(channel, execution);

  const needsApproval =
    execution?.status === 'previewed' &&
    (page || blogArticle || seo || googleCampaign || metaCampaign || mailchimpSequence) &&
    Boolean(onApprove);

  const draftReasoning =
    aiReasoning ?? extractExecutionReasoning(execution);

  const onCopy = async () => {
    if (!execution) return;
    const text = assist
      ? assistCopyText(execution, channel)
      : seo
        ? `${seo.seoTitle}\n\n${seo.seoDescription}`
        : null;
    if (!text) return;
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const detailContent = (
    <>
      {embedded && error ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <p className="auth-error" style={{ fontSize: 12, margin: 0 }}>
            {error}
          </p>
          {onRestart ? (
            <Button
              variant="primary"
              type="button"
              disabled={restarting || pending}
              onClick={onRestart}
              style={{ justifySelf: 'start' }}
            >
              {restarting || pending ? 'Restarting…' : 'Restart'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {embedded && pending && !error ? (
        <p className="t-dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          {restarting ? 'Regenerating deliverable…' : 'Preparing your deliverable…'}
        </p>
      ) : null}

      {embedded && !execution && !error ? (
        <div style={{ display: 'grid', gap: 10, fontSize: 13, lineHeight: 1.55 }}>
          {why ? <p className="t-dim" style={{ margin: 0 }}>{why}</p> : null}
          {outcome ? (
            <p className="t-dim" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Goal · </strong>
              {outcome}
            </p>
          ) : null}
          {kpi ? (
            <p className="t-dim" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Track · </strong>
              {kpi}
            </p>
          ) : null}
          {onRunAction ? (
            <Button
              variant="primary"
              type="button"
              disabled={isRunning}
              onClick={onRunAction}
              style={{ justifySelf: 'start', marginTop: 4 }}
            >
              {isRunning ? 'Running agent…' : 'Run this action'}
            </Button>
          ) : onPrepare ? (
            <Button
              variant="primary"
              type="button"
              disabled={isRunning}
              onClick={onPrepare}
              style={{ justifySelf: 'start', marginTop: 4 }}
            >
              {isRunning ? 'Running agent…' : 'Run this action'}
            </Button>
          ) : null}
          {onRestart ? (
            <Button
              variant="ghost"
              type="button"
              disabled={isRunning}
              onClick={onRestart}
              style={{ justifySelf: 'start' }}
            >
              {isRunning ? 'Regenerating…' : 'Regenerate'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {expanded && assist ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {isAdvertPlan ? 'Your advert plan' : 'Your deliverable'}
          </div>
          {channel === 'instagram' && assist.proposedImageUrl ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(234, 179, 8, 0.08)',
                  border: '1px solid rgba(234, 179, 8, 0.25)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--text-dim)',
                }}
              >
                Review this image before posting. Use your own product photo if it does not match your brand.
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assist.proposedImageUrl}
                alt={assist.imageAlt ?? 'Proposed Instagram image'}
                style={{
                  width: '100%',
                  maxWidth: 360,
                  borderRadius: 8,
                  objectFit: 'cover',
                  aspectRatio: '1 / 1',
                }}
              />
              {assist.imageRationale ? (
                <p className="auth-hint" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
                  {assist.imageRationale}
                </p>
              ) : null}
              {assist.imageAttribution ? (
                <p className="auth-hint" style={{ margin: 0, fontSize: 11, lineHeight: 1.45 }}>
                  {assist.imageAttribution}
                </p>
              ) : null}
              {assist.imageSource ? (
                <p className="t-mono" style={{ margin: 0, fontSize: 10, color: 'var(--text-mute)' }}>
                  Source: {assist.imageSource}
                </p>
              ) : null}
            </div>
          ) : null}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--surface-2, rgba(255,255,255,0.03))',
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{assist.headline}</div>
            {isAdvertPlan ? (
              <>
                <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
                  Overview
                </div>
                {assist.primaryCopy}
              </>
            ) : (
              assist.primaryCopy
            )}
          </div>
          {isAdvertPlan && orderedAdvertPlanExtras(assist.extras).length > 0 ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.03))',
                fontSize: 13,
              }}
            >
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 10 }}>
                Campaign setup
              </div>
              {orderedAdvertPlanExtras(assist.extras).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                    {advertPlanExtraLabel(key)}
                  </span>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{value}</div>
                </div>
              ))}
            </div>
          ) : null}
          {!isAdvertPlan && Object.keys(assist.extras).length > 0 ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.03))',
                fontSize: 13,
              }}
            >
              {Object.entries(assist.extras).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 8 }}>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                    {key}
                  </span>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{value}</div>
                </div>
              ))}
            </div>
          ) : null}
          {isAdvertPlan && assist.steps.length > 0 ? (
            <div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
                Launch checklist
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                {assist.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {assist.pasteInstructions ? (
            <p className="auth-hint" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
              <strong>{isAdvertPlan ? 'Build in: ' : 'Where to apply: '}</strong>
              {assist.pasteInstructions}
            </p>
          ) : null}
          <Button variant="primary" type="button" onClick={() => void onCopy()}>
            {copied ? 'Copied' : isAdvertPlan ? 'Copy advert plan' : 'Copy deliverable'}
          </Button>
          {assist.shopifyMcpPrompt ? (
            <div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
                Claude.ai + Shopify MCP prompt
              </div>
              <pre
                style={{
                  margin: '0 0 8px',
                  fontSize: 11,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 240,
                  overflow: 'auto',
                  padding: 10,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                }}
              >
                {assist.shopifyMcpPrompt}
              </pre>
              <Button
                variant="primary"
                type="button"
                onClick={async () => {
                  await copyText(assist.shopifyMcpPrompt!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy MCP prompt'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded && igPublish && execution?.status === 'executed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {igPublish.mediaType === 'reel'
              ? 'Published Instagram Reel'
              : igPublish.mediaType === 'story'
                ? 'Published Instagram Story'
                : 'Published to Instagram'}
          </div>
          <Chip variant="success">
            {igPublish.mediaType === 'reel' ? 'Live Reel' : 'Live on Instagram'}
          </Chip>
          {igPublish.mediaType === 'reel' && igPublish.videoUrl ? (
            <video
              src={igPublish.videoUrl}
              controls
              playsInline
              style={{
                width: '100%',
                maxWidth: 360,
                borderRadius: 8,
                background: '#000',
                aspectRatio: '9 / 16',
              }}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={igPublish.imageUrl}
              alt="Published Instagram post"
              style={{
                width: '100%',
                maxWidth: 360,
                borderRadius: 8,
                objectFit: 'cover',
                aspectRatio: '1 / 1',
              }}
            />
          )}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--surface-2, rgba(255,255,255,0.03))',
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
            }}
          >
            {igPublish.caption}
          </div>
          {igPublish.imageSource ? (
            <p className="auth-hint" style={{ margin: 0, fontSize: 12 }}>
              Image source: {igPublish.imageSource}
              {igPublish.imageSource === 'canva' && igPublish.canvaDesignId
                ? ` · design ${igPublish.canvaDesignId}`
                : ''}
            </p>
          ) : null}
          {igPublish.imageRationale ? (
            <p className="auth-hint" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
              {igPublish.imageRationale}
            </p>
          ) : null}
          {igPublish.canvaEditUrl ? (
            <Link
              href={igPublish.canvaEditUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13 }}
            >
              Open design in Canva
            </Link>
          ) : null}
          {igPublish.permalink ? (
            <Link href={igPublish.permalink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
              {igPublish.mediaType === 'story'
                ? 'View story on Instagram'
                : igPublish.mediaType === 'reel'
                  ? 'View Reel on Instagram'
                  : igPublish.mediaType === 'carousel'
                    ? 'View carousel on Instagram'
                    : 'View post on Instagram'}
            </Link>
          ) : igPublish.mediaType === 'story' ? (
            <p className="auth-hint" style={{ margin: 0, fontSize: 12 }}>
              Story published (Stories often have no lasting public link — check Instagram Stories / archive).
            </p>
          ) : null}
          {igPublish.imageAttribution ? (
            <p className="auth-hint" style={{ margin: 0, fontSize: 11 }}>
              {igPublish.imageAttribution}
            </p>
          ) : null}
        </div>
      ) : null}

      {expanded && blogArticle && execution?.status === 'executed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your deliverable
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            {blogArticle.isPublished ? 'Published' : 'Draft'} in Shopify · /blogs/{blogArticle.blogHandle}/{blogArticle.handle}
          </div>
          <strong style={{ fontSize: 14 }}>{blogArticle.title}</strong>
          {blogArticle.shopDomain && blogArticle.blogHandle ? (
            <Link
              href={`https://${blogArticle.shopDomain}/blogs/${blogArticle.blogHandle}/${blogArticle.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13 }}
            >
              View article in store
            </Link>
          ) : null}
          <div
            style={{ fontSize: 13, lineHeight: 1.55, maxHeight: 320, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: blogArticle.bodyHtml }}
          />
        </div>
      ) : null}

      {expanded && blogArticle && execution?.status === 'previewed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your deliverable
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            Proposed article · /blogs/{blogArticle.blogHandle ?? '…'}/{blogArticle.handle}
          </div>
          <strong style={{ fontSize: 14 }}>{blogArticle.title}</strong>
          <div
            style={{ fontSize: 13, lineHeight: 1.55, maxHeight: 320, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: blogArticle.bodyHtml }}
          />
          <p className="t-dim" style={{ fontSize: 12, margin: 0 }}>
            Approve to publish this article in Shopify.
          </p>
        </div>
      ) : null}

      {expanded && page && execution?.status === 'executed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your deliverable
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            {page.isPublished ? 'Published' : 'Created'} in Shopify · /pages/{page.handle}{page.isPublished ? '' : ' (draft)'}
          </div>
          <strong style={{ fontSize: 14 }}>{page.title}</strong>
          {page.shopDomain ? (
            <Link
              href={`https://${page.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/pages/${page.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13 }}
            >
              {page.isPublished ? 'View page on Shopify' : 'Open page on Shopify'}
            </Link>
          ) : null}
          <div
            style={{ fontSize: 13, lineHeight: 1.55, maxHeight: 320, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: page.bodyHtml }}
          />
        </div>
      ) : null}

      {expanded && page && execution?.status === 'previewed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your deliverable
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            Proposed page · /pages/{page.handle} (draft)
          </div>
          <strong style={{ fontSize: 14 }}>{page.title}</strong>
          <div style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            {page.seoTitle} — {page.seoDescription}
          </div>
          <div
            style={{ fontSize: 13, lineHeight: 1.55, maxHeight: 320, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: page.bodyHtml }}
          />
          {page.shopifyMcpPrompt ? (
            <>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 180,
                  overflow: 'auto',
                  padding: 10,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                }}
              >
                {page.shopifyMcpPrompt}
              </pre>
              <Button
                variant="primary"
                type="button"
                onClick={async () => {
                  await copyText(page.shopifyMcpPrompt!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy MCP prompt'}
              </Button>
            </>
          ) : (
            <p className="t-dim" style={{ fontSize: 12, margin: 0 }}>
              Approve to create this page in Shopify.
            </p>
          )}
        </div>
      ) : null}

      {expanded && metaCampaign && execution?.status === 'executed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your advert plan
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            Created in Meta Ads · paused — you enable spending when ready
          </div>
          <strong style={{ fontSize: 14 }}>{metaCampaign.campaignName}</strong>
          {metaCampaign.campaignId ? (
            <p className="t-mono" style={{ fontSize: 11, margin: 0, color: 'var(--text-mute)' }}>
              Campaign ID {metaCampaign.campaignId}
            </p>
          ) : null}
          <p className="t-dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
            {formatAdBudget(metaCampaign.dailyBudget, metaCampaign.currencyCode)}/day ·{' '}
            {metaCampaign.targeting.countries.join(', ')} · ages {metaCampaign.targeting.ageMin}–
            {metaCampaign.targeting.ageMax}
          </p>
          <Link
            href={metaAdsConsoleUrl(metaCampaign.adAccountId, metaCampaign.campaignId)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ justifySelf: 'start', textDecoration: 'none' }}
          >
            Open in Meta Ads Manager to review &amp; start
          </Link>
        </div>
      ) : null}

      {expanded && metaCampaign && execution?.status === 'previewed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your advert plan
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            Agent draft · creatives auto-generated · paused until you enable spend
          </div>
          <strong style={{ fontSize: 14 }}>{metaCampaign.campaignName}</strong>
          <p className="t-dim" style={{ fontSize: 13, margin: 0 }}>
            {formatAdBudget(metaCampaign.dailyBudget, metaCampaign.currencyCode)}/day ·{' '}
            {metaCampaign.targeting.countries.join(', ')} · ages {metaCampaign.targeting.ageMin}–
            {metaCampaign.targeting.ageMax}
            {metaCampaign.targeting.interestNotes
              ? ` · ${metaCampaign.targeting.interestNotes}`
              : ''}
          </p>
          {metaCampaign.ads.map((ad) => (
            <div
              key={ad.name}
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.03))',
                fontSize: 13,
                display: 'grid',
                gridTemplateColumns: ad.imageUrl ? '88px 1fr' : '1fr',
                gap: 12,
                alignItems: 'start',
              }}
            >
              {ad.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ad.imageUrl}
                  alt={ad.name}
                  style={{
                    width: 88,
                    height: 110,
                    objectFit: 'cover',
                    borderRadius: 8,
                    background: 'var(--surface-2)',
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{ad.name}</div>
                {ad.imageSource ? (
                  <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>
                    Creative: {ad.imageSource}
                  </div>
                ) : null}
                <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 4 }}>
                  Primary text
                </div>
                <div style={{ marginBottom: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ad.primaryText}</div>
                <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 4 }}>
                  Headline · CTA
                </div>
                <div style={{ marginBottom: 8 }}>{ad.headline} · {ad.cta.replace(/_/g, ' ')}</div>
                <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                  Landing page
                </div>
                <div style={{ fontSize: 12 }}>{ad.finalUrl}</div>
              </div>
            </div>
          ))}
          {execution?.errorMessage ? (
            <p className="auth-error" style={{ fontSize: 12, margin: '0 0 8px', lineHeight: 1.5 }}>
              {execution.errorMessage}
            </p>
          ) : null}
          <p className="t-dim" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
            Autopilot creates this <strong>paused</strong> in Meta with the images above. Your only job is enable spend in Ads Manager when happy.
          </p>
        </div>
      ) : null}

      {expanded && mailchimpSequence ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Email sequence
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            {execution?.status === 'executed'
              ? 'Drafts in Mailchimp — review and send there (never auto-sent)'
              : 'Agent draft · will create Mailchimp drafts (not sent)'}
          </div>
          <strong style={{ fontSize: 14 }}>{mailchimpSequence.sequenceName}</strong>
          <p className="t-dim" style={{ fontSize: 13, margin: 0 }}>
            From {mailchimpSequence.fromName} · {mailchimpSequence.replyTo}
            {mailchimpSequence.listName ? ` · ${mailchimpSequence.listName}` : ''}
          </p>
          {mailchimpSequence.emails.map((email, i) => (
            <div
              key={`${email.dayOffset}-${email.subject}-${i}`}
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.03))',
                fontSize: 13,
              }}
            >
              <strong style={{ fontSize: 13 }}>
                Day {email.dayOffset}: {email.subject}
              </strong>
              <p
                className="t-dim"
                style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
              >
                {email.bodyPlain.slice(0, 400)}
                {email.bodyPlain.length > 400 ? '…' : ''}
              </p>
            </div>
          ))}
          {execution?.status === 'executed' ? (
            <a
              href="https://admin.mailchimp.com/campaigns/"
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
              style={{ justifySelf: 'start', textDecoration: 'none' }}
            >
              Open Mailchimp campaigns
            </a>
          ) : null}
        </div>
      ) : null}

      {expanded && googleCampaign && execution?.status === 'executed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your deliverable
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            Created in Google Ads · paused — you enable spending when ready
          </div>
          <strong style={{ fontSize: 14 }}>{googleCampaign.campaignName}</strong>
          <p className="t-dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
            ${googleCampaign.dailyBudgetUsd}/day · {googleCampaign.adGroups.length} ad group
            {googleCampaign.adGroups.length === 1 ? '' : 's'}
          </p>
          <Link
            href={googleAdsConsoleUrl(googleCampaign.customerId)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ justifySelf: 'start', textDecoration: 'none' }}
          >
            Open in Google Ads to review &amp; start
          </Link>
        </div>
      ) : null}

      {expanded && googleCampaign && execution?.status === 'previewed' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your advert plan
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            Proposed Search campaign · paused until you approve in Google Ads
          </div>
          <strong style={{ fontSize: 14 }}>{googleCampaign.campaignName}</strong>
          <p className="t-dim" style={{ fontSize: 13, margin: 0 }}>
            ${googleCampaign.dailyBudgetUsd}/day budget · {googleCampaign.adGroups.length} ad group
            {googleCampaign.adGroups.length === 1 ? '' : 's'}
          </p>
          {googleCampaign.adGroups.map((group) => (
            <div
              key={group.name}
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.03))',
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{group.name}</div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 4 }}>
                Keywords
              </div>
              <div style={{ marginBottom: 10, lineHeight: 1.5 }}>
                {group.keywords.map((kw) => `${kw.text} (${kw.matchType})`).join(' · ')}
              </div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 4 }}>
                Headlines
              </div>
              <div style={{ marginBottom: 10, lineHeight: 1.5 }}>{group.headlines.join(' · ')}</div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 4 }}>
                Descriptions
              </div>
              <div style={{ marginBottom: 8, lineHeight: 1.5 }}>{group.descriptions.join(' · ')}</div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                Landing page
              </div>
              <div style={{ fontSize: 12 }}>{group.finalUrl}</div>
            </div>
          ))}
          <p className="t-dim" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
            Approve creates this campaign <strong>paused</strong> in your Google Ads account. Hundres never turns on spend — you review and enable it in Google Ads.
          </p>
        </div>
      ) : null}

      {expanded && seo && (execution?.status === 'executed' || execution?.status === 'previewed') ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your deliverable
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
            {execution?.status === 'executed' ? 'Applied in Shopify' : 'Proposed SEO change'} · {execution?.targetLabel}
          </div>
          <strong style={{ fontSize: 14 }}>{seo.seoTitle}</strong>
          <div style={{ color: 'var(--text-mute)', fontSize: 13, lineHeight: 1.55 }}>{seo.seoDescription}</div>
          {execution?.status === 'previewed' ? (
            <p className="t-dim" style={{ fontSize: 12, margin: 0 }}>
              Approve to apply in Shopify.
            </p>
          ) : null}
        </div>
      ) : null}

      {scopeWarning ? (
        <p className="auth-hint" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
          {scopeWarning}
        </p>
      ) : null}

      {needsApproval ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <Button
            variant="primary"
            type="button"
            disabled={approving || pending || !canExecute}
            onClick={onApprove}
          >
            {approving
              ? 'Creating…'
              : metaCampaign
                ? 'Create paused in Meta (images ready)'
                : mailchimpSequence
                  ? 'Create drafts in Mailchimp'
                : googleCampaign
                  ? 'Create paused in Google Ads'
                  : page
                    ? 'Create page in Shopify'
                    : 'Approve & apply'}
          </Button>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div style={{ display: 'grid', gap: 10 }}>{detailContent}</div>;
  }

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderColor: status === 'ready' ? 'var(--accent-dim, var(--border))' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
            {pending ? (
              <Chip variant="accent">Working…</Chip>
            ) : status === 'ready' ? (
              <Chip variant="success">Ready</Chip>
            ) : status === 'review' ? (
              <Chip variant="warn">Needs review</Chip>
            ) : status === 'failed' ? (
              <Chip variant="warn">Failed</Chip>
            ) : (
              <Chip>Queued</Chip>
            )}
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>
              {channel}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>{title}</div>
          {why ? (
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              className="btn-ghost"
              style={{ padding: 0, marginTop: 6, fontSize: 12, color: 'var(--accent)' }}
            >
              {whyOpen ? 'Hide why' : 'Why this?'}
            </button>
          ) : null}
          {whyOpen && why ? (
            <p className="t-dim" style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.55 }}>
              {why}
            </p>
          ) : null}
          {execution?.summary && !pending ? (
            <p className="t-dim" style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>
              {execution.summary}
            </p>
          ) : null}
          {error ? (
            <p className="auth-error" style={{ fontSize: 12, margin: '8px 0 0' }}>
              {error}
            </p>
          ) : null}
          {(routingReasoning || draftReasoning) && !pending ? (
            <ReasoningBlock routing={routingReasoning} ai={draftReasoning} />
          ) : null}
        </div>
        {(assist || seo || page || googleCampaign || metaCampaign) && !pending ? (
          <Button variant="ghost" type="button" onClick={() => setExpanded((v) => !v)} style={{ flexShrink: 0 }}>
            {expanded ? 'Hide' : 'Show'}
          </Button>
        ) : null}
      </div>

      {detailContent}
    </div>
  );
}
