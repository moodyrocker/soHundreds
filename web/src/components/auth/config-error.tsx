export function ConfigError({ message }: { message: string }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Configuration required</h1>
        <p className="auth-error">{message}</p>
        <p className="auth-sub" style={{ marginTop: 16 }}>
          For Docker, set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env</code>, then run:
        </p>
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            fontSize: 12,
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            overflow: 'auto',
          }}
        >
          docker compose build --no-cache web && docker compose up -d web
        </pre>
      </div>
    </div>
  );
}
