'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Icon } from '@/components/hundres/icon';
import { apiFetch } from '@/lib/api';
import type { Organization } from '@/lib/auth-types';
import { useAuth } from '@/providers/auth-provider';

export function OrgSetupForm() {
  const router = useRouter();
  const { accessToken, refreshMe } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch<Organization>('/api/organizations', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ name }),
      });
      await refreshMe();
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Create your workspace</h1>
        <p className="auth-sub">You need an organization before using Hundres.</p>
        <form onSubmit={onSubmit} className="auth-form">
          <label className="auth-field">
            <span className="auth-label">Business name</span>
            <input
              className="auth-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your company or project name"
              required
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <Button variant="primary" type="submit" disabled={submitting || !name.trim()} className="auth-submit">
            Continue
            <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
          </Button>
        </form>
      </div>
    </div>
  );
}
