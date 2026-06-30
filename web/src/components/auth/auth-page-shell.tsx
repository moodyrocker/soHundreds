import type { ReactNode } from 'react';

export function AuthPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">Hundres</div>
            <div className="brand-org">Marketing AI for small business</div>
          </div>
        </div>
        <h1 className="auth-title">{title}</h1>
        {subtitle ? <p className="auth-sub">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}
