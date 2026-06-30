'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { Tone } from '@/lib/channels';
import type { DensityId, ThemeId } from '@/providers/app-preferences-provider';
import { useAppPreferences } from '@/providers/app-preferences-provider';

const THEME_OPTIONS: { value: ThemeId; label: string; bg: string; fg: string }[] = [
  { value: 'ink', label: 'Ink', bg: '#FFFFFF', fg: '#71717A' },
  { value: 'paper', label: 'Paper', bg: '#F7F4EF', fg: '#7A7363' },
  { value: 'lime', label: 'Slate', bg: '#1C1F23', fg: '#888892' },
];

const ROUTES = [
  { href: '/', label: 'Dashboard' },
  { href: '/new', label: 'Goal input' },
  { href: '/thinking', label: 'Thinking' },
  { href: '/plan', label: 'Plan' },
];

export function DevTweaksPanel() {
  const pathname = usePathname();
  const { theme, density, tone, hideAids, setTheme, setDensity, setTone, setHideAids } = useAppPreferences();
  const [open, setOpen] = useState(true);

  if (process.env.NODE_ENV !== 'development') return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn"
        style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9999 }}
      >
        Tweaks
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        width: 280,
        maxHeight: 'calc(100vh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(250,249,247,.92)',
        border: '1px solid var(--border-strong)',
        fontSize: 11.5,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <b style={{ fontSize: 12 }}>Tweaks</b>
        <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
      <div style={{ padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section label="Theme">
          <div style={{ display: 'flex', gap: 8 }}>
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setTheme(o.value)}
                style={{
                  width: 56,
                  height: 40,
                  border: theme === o.value ? '1.5px solid var(--accent)' : '1.5px solid rgba(0,0,0,0.1)',
                  background: o.bg,
                  color: o.fg,
                  fontSize: 9,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Segment label="Density" value={density} options={['cozy', 'comfortable', 'spacious']} labels={['Cozy', 'Comfy', 'Spacious']} onChange={(v) => setDensity(v as DensityId)} />
        </Section>

        <Section label="AI personality">
          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Tone
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
              style={{ display: 'block', width: '100%', marginTop: 6, height: 28, border: '1px solid var(--border)', background: 'var(--bg-elev)' }}
            >
              <option value="expert">Expert mentor</option>
              <option value="coach">Coach</option>
              <option value="peer">Friendly peer</option>
              <option value="pro">Pro strategist</option>
            </select>
          </label>
        </Section>

        <Section label="Novice aids">
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
            Show why this works
            <input type="checkbox" checked={!hideAids} onChange={(e) => setHideAids(!e.target.checked)} />
          </label>
        </Section>

        <Section label="Navigate">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {ROUTES.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="btn"
                style={{
                  justifyContent: 'center',
                  background: pathname === r.href ? 'var(--accent)' : undefined,
                  color: pathname === r.href ? 'var(--accent-on)' : undefined,
                }}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-mute)', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Segment({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, marginBottom: 6, color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className="btn"
            style={{
              flex: 1,
              height: 28,
              fontSize: 11,
              background: value === opt ? 'var(--accent)' : undefined,
              color: value === opt ? 'var(--accent-on)' : undefined,
            }}
          >
            {labels[i]}
          </button>
        ))}
      </div>
    </div>
  );
}
