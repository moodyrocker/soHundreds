'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Card } from '@/components/hundres/card';
import { Chip } from '@/components/hundres/chip';
import { Icon } from '@/components/hundres/icon';
import { createOrganization, deleteOrganization } from '@/lib/organizations';
import { dataSourceLabel, type StrategyRecord } from '@/lib/plan-types';
import { deleteStrategy, listStrategies } from '@/lib/strategy';
import { useAuth } from '@/providers/auth-provider';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function planReviewLink(plan: StrategyRecord): { href: string; title: string } | null {
  if (plan.status === 'generating') {
    return { href: `/thinking?strategyId=${plan.id}`, title: 'View generation progress' };
  }
  if (plan.status === 'active' && plan.plan) {
    return { href: `/plan?id=${plan.id}`, title: 'Review plan' };
  }
  return null;
}

export function SettingsView() {
  const {
    accessToken,
    organizations,
    activeOrganization,
    setActiveOrganization,
    refreshMe,
    signOut,
  } = useAuth();

  const [plans, setPlans] = useState<StrategyRecord[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [newOrgName, setNewOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    if (!accessToken || !activeOrganization) return;
    setLoadingPlans(true);
    try {
      const { strategies } = await listStrategies(accessToken, activeOrganization.id, 25);
      setPlans(strategies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    } finally {
      setLoadingPlans(false);
    }
  }, [accessToken, activeOrganization]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const onSwitchOrg = (orgId: string) => {
    setActiveOrganization(orgId);
    setError(null);
  };

  const onCreateOrg = async () => {
    if (!accessToken || !newOrgName.trim()) return;
    setBusy('create-org');
    setError(null);
    try {
      const org = await createOrganization(accessToken, newOrgName.trim());
      setNewOrgName('');
      await refreshMe();
      setActiveOrganization(org.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setBusy(null);
    }
  };

  const onDeleteOrg = async (orgId: string, orgName: string) => {
    if (!accessToken) return;
    const ok = window.confirm(
      `Delete workspace "${orgName}"? This removes all plans, integrations, and check-ups for that workspace. This cannot be undone.`
    );
    if (!ok) return;

    setBusy(`delete-org-${orgId}`);
    setError(null);
    try {
      await deleteOrganization(accessToken, orgId);
      await refreshMe();
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hundres:active_org_id');
      }
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace');
    } finally {
      setBusy(null);
    }
  };

  const onDeletePlan = async (plan: StrategyRecord) => {
    if (!accessToken || !activeOrganization) return;
    const ok = window.confirm(
      `Delete this plan?\n\n"${plan.goal.slice(0, 120)}${plan.goal.length > 120 ? '…' : ''}"\n\nThis cannot be undone.`
    );
    if (!ok) return;

    setBusy(`delete-plan-${plan.id}`);
    setError(null);
    try {
      await deleteStrategy(accessToken, activeOrganization.id, plan.id);
      setPlans((prev) => prev.filter((p) => p.id !== plan.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    } finally {
      setBusy(null);
    }
  };

  const active = activeOrganization;

  return (
    <>
      <div className="dash-greeting">
        <div>
          <div className="h-eyebrow" style={{ marginBottom: 12 }}>
            Account
          </div>
          <h1 className="h-display">Settings</h1>
          <p className="t-dim" style={{ fontSize: 17, marginTop: 10, maxWidth: 560 }}>
            Manage workspaces and plans. Each workspace is created at signup or when you add a new
            business — that&apos;s why you may see <strong>Switch org</strong> if you have more than
            one.
          </p>
        </div>
        <Button variant="ghost" type="button" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>

      {error ? <p className="auth-error" style={{ marginBottom: 16 }}>{error}</p> : null}

      <Card style={{ marginBottom: 24 }}>
        <div className="h-eyebrow" style={{ marginBottom: 12 }}>
          Workspaces
        </div>
        <p className="t-dim" style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55 }}>
          Active: <strong>{active?.name ?? 'None'}</strong>
          {active ? <Chip>{active.role}</Chip> : null}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {organizations.map((org) => (
            <div
              key={org.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                padding: '10px 0',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{org.name}</div>
                <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>
                  {org.role} · {org.id.slice(0, 8)}…
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {org.id !== active?.id ? (
                  <Button variant="ghost" type="button" onClick={() => onSwitchOrg(org.id)}>
                    Switch here
                  </Button>
                ) : (
                  <Chip variant="success">Active</Chip>
                )}
                {org.role === 'owner' && organizations.length > 1 ? (
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy === `delete-org-${org.id}`}
                    onClick={() => void onDeleteOrg(org.id, org.name)}
                  >
                    {busy === `delete-org-${org.id}` ? 'Deleting…' : 'Delete'}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="auth-field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
            <span className="auth-label">New workspace</span>
            <input
              className="auth-input"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Another business or project name"
            />
          </label>
          <Button
            variant="primary"
            type="button"
            disabled={!newOrgName.trim() || busy === 'create-org'}
            onClick={() => void onCreateOrg()}
          >
            {busy === 'create-org' ? 'Creating…' : 'Add workspace'}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="h-eyebrow" style={{ marginBottom: 12 }}>
          Plans in this workspace
        </div>
        <p className="t-dim" style={{ margin: '0 0 16px', fontSize: 14 }}>
          Open any plan to review it, or delete old and test plans. The dashboard shows the latest{' '}
          <strong>active</strong> plan.
        </p>

        {loadingPlans ? (
          <p className="t-dim">Loading plans…</p>
        ) : plans.length === 0 ? (
          <p className="t-dim">No plans saved yet.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {plans.map((plan, i) => {
              const review = planReviewLink(plan);
              return (
              <li
                key={plan.id}
                style={{
                  padding: '14px 0',
                  borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>{plan.goal}</div>
                    <div className="t-mono" style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 6 }}>
                      {formatDate(plan.createdAt)} · {plan.status} · {dataSourceLabel(plan.dataSource)}
                      {plan.actionCount > 0 ? ` · ${plan.actionCount} actions` : ''}
                    </div>
                    {plan.refinementNotes ? (
                      <p className="auth-hint" style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.45 }}>
                        Refinement: {plan.refinementNotes.slice(0, 160)}
                        {plan.refinementNotes.length > 160 ? '…' : ''}
                      </p>
                    ) : null}
                    {plan.status === 'failed' && plan.generationError ? (
                      <p className="auth-hint" style={{ margin: '8px 0 0', fontSize: 12 }}>
                        {plan.generationError}
                      </p>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {review ? (
                      <Link
                        href={review.href}
                        className="icon-btn"
                        title={review.title}
                        aria-label={review.title}
                      >
                        <Icon name="plans" width={16} height={16} />
                      </Link>
                    ) : null}
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy === `delete-plan-${plan.id}`}
                      onClick={() => void onDeletePlan(plan)}
                    >
                      {busy === `delete-plan-${plan.id}` ? 'Deleting…' : 'Delete plan'}
                    </Button>
                  </div>
                </div>
              </li>
            );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
