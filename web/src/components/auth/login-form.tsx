'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/hundres/button';
import { Icon } from '@/components/hundres/icon';
import { AuthPageShell } from '@/components/auth/auth-page-shell';
import { ConfigError } from '@/components/auth/config-error';
import { useAuth } from '@/providers/auth-provider';

function LoginFormInner() {
  const searchParams = useSearchParams();
  const { signIn, configError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (configError) {
    return <ConfigError message={configError} />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const next = searchParams.get('next');
      const redirectTo = next && next.startsWith('/') ? next : '/';
      await signIn(email, password, redirectTo);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      if (/email not confirmed/i.test(message)) {
        setError('Please confirm your email address first, then sign in.');
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell title="Sign in" subtitle="Access your workspace and marketing plans.">
        <form onSubmit={onSubmit} className="auth-form">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <Button variant="primary" type="submit" disabled={submitting} className="auth-submit">
            {submitting ? 'Signing in…' : 'Sign in'}
            <Icon name="arrow-right" style={{ width: 13, height: 13 }} />
          </Button>
        </form>

        <p className="auth-foot">
          No account?{' '}
          <Link href="/signup" className="auth-link">
            Create one
          </Link>
        </p>
    </AuthPageShell>
  );
}

export function LoginForm() {
  return (
    <Suspense
      fallback={
        <AuthPageShell title="Sign in" subtitle="Access your workspace and marketing plans." />
      }
    >
      <LoginFormInner />
    </Suspense>
  );
}
