import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      borderRadius: {
        none: '0',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        full: 'var(--r-full)',
      },
      spacing: {
        'gap-1': 'var(--gap-1)',
        'gap-2': 'var(--gap-2)',
        'gap-3': 'var(--gap-3)',
        'gap-4': 'var(--gap-4)',
        'gap-5': 'var(--gap-5)',
        'gap-6': 'var(--gap-6)',
        'gap-7': 'var(--gap-7)',
        'gap-8': 'var(--gap-8)',
        'gap-9': 'var(--gap-9)',
      },
      colors: {
        bg: 'var(--bg)',
        'bg-elev': 'var(--bg-elev)',
        'bg-elev-2': 'var(--bg-elev-2)',
        'bg-elev-3': 'var(--bg-elev-3)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        'border-bright': 'var(--border-bright)',
        text: 'var(--text)',
        'text-dim': 'var(--text-dim)',
        'text-mute': 'var(--text-mute)',
        'text-faint': 'var(--text-faint)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-dim': 'var(--accent-dim)',
        'accent-glow': 'var(--accent-glow)',
        'accent-on': 'var(--accent-on)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        'hue-instagram': 'var(--hue-instagram)',
        'hue-email': 'var(--hue-email)',
        'hue-seo': 'var(--hue-seo)',
        'hue-content': 'var(--hue-content)',
        'hue-paid': 'var(--hue-paid)',
        'hue-local': 'var(--hue-local)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        base: ['14.5px', { lineHeight: '1.5' }],
      },
    },
  },
  plugins: [],
};

export default config;
