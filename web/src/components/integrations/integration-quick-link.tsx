'use client';

import { Icon } from '@/components/hundres/icon';

type Props = {
  href: string;
  label: string;
};

export function IntegrationQuickLink({ href, label }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-ghost"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      {label}
      <Icon name="globe" style={{ width: 13, height: 13 }} aria-hidden />
    </a>
  );
}
