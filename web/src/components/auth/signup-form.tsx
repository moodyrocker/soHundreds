'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Icon } from '@/components/hundres/icon';
import { useAuth } from '@/providers/auth-provider';

export function SignupForm() {
  const { signUp } = useAuth();

  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signUp(
        email,
        password,
        fullName || undefined,
        organizationName || undefined
      );
      if (result.needsEmailConfirmation) {
        setConfirmationEmail(result.email);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmationEmail) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card-success">
          <div className="auth-success-icon" aria-hidden>
            <Icon name="mail" style={{ width: 28, height: 28 }} />
          </div>

          <h1 className="auth-title">Please confirm your email address</h1>
          <p className="auth-sub">
            We sent a confirmation link to{' '}
            <strong className="auth-email-highlight">{confirmationEmail}</strong>. Open it to
            activate your account, then sign in.
          </p>

          <p className="auth-success-note">
            Didn&apos;t get it? Check spam, or wait a minute and try signing up again with the same
            email.
          </p>

          <Link href="/login" className="auth-submit-link">
            <Button variant="primary" className="auth-submit">
              Go to sign in
              <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
      <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">Hundres</div>
            <div className="brand-org">Start your first marketing plan</div>
          </div>
        </div>

        <h1 className="auth-title">Create account</h1>
        <p className="auth-sub">One workspace per business. You&apos;ll be the owner.</p>

        <form onSubmit={onSubmit} className="auth-form">
          <label className="auth-field">
            <span className="auth-label">Your name</span>
            <input className="auth-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>

          <label className="auth-field">
            <span className="auth-label">Business / organization</span>
            <input
              className="auth-input"
              placeholder="Your company or project name"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <span className="auth-hint">At least 8 characters</span>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <Button variant="primary" type="submit" disabled={submitting} className="auth-submit">
            {submitting ? 'Creating…' : 'Create account'}
            <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
          </Button>
        </form>

        <p className="auth-foot">
          Already have an account?{' '}
          <Link href="/login" className="auth-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
