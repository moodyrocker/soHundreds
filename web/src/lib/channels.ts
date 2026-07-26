import type { IconName } from '@/components/hundres/icon';

export type ChannelId =
  | 'instagram'
  | 'email'
  | 'seo'
  | 'content'
  | 'paid'
  | 'local';

export type Tone = 'expert' | 'coach' | 'peer' | 'pro';

export type Impact = 'high' | 'med' | 'low';

export interface Channel {
  id: ChannelId;
  label: string;
  color: string;
  icon: IconName;
}

export const CHANNELS: Record<ChannelId, Channel> = {
  instagram: { id: 'instagram', label: 'Instagram', color: 'var(--hue-instagram)', icon: 'ig' },
  email: { id: 'email', label: 'Email', color: 'var(--hue-email)', icon: 'mail' },
  seo: { id: 'seo', label: 'SEO', color: 'var(--hue-seo)', icon: 'globe' },
  content: { id: 'content', label: 'Content', color: 'var(--hue-content)', icon: 'edit' },
  paid: { id: 'paid', label: 'Paid ads', color: 'var(--hue-paid)', icon: 'target' },
  local: { id: 'local', label: 'Local', color: 'var(--hue-local)', icon: 'users' },
};
