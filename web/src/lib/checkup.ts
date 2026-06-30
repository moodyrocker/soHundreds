import { apiFetch } from '@/lib/api';

export type CheckupMetric = {
  source: 'google_analytics' | 'google_ads' | 'meta_ads' | 'shopify' | 'general';
  label: string;
  value: string;
};

export type CheckupCoverage = {
  source: 'google_analytics' | 'google_ads' | 'meta_ads' | 'shopify';
  connected: boolean;
  loaded: boolean;
  note?: string | null;
};

export type CheckupPriority = {
  title: string;
  why: string;
  impact: 'high' | 'med' | 'low';
};

export type CheckupDocument = {
  headline: string;
  overallHealth: 'good' | 'fair' | 'weak' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  liveMetrics: CheckupMetric[];
  dataCoverage: CheckupCoverage[];
  whatsWorking: string[];
  whatsWeak: string[];
  whatsMissing: string[];
  topPriorities: CheckupPriority[];
  summary: string;
};

export type CheckupRecord = {
  id: string;
  organizationId: string;
  dataSource: string;
  report: CheckupDocument;
  createdAt: string;
};

const CHECKUP_TIMEOUT_MS = 120_000;

export function runCheckup(token: string, organizationId: string) {
  return apiFetch<{ checkup: CheckupRecord }>('/api/checkup/run', {
    method: 'POST',
    token,
    organizationId,
    timeoutMs: CHECKUP_TIMEOUT_MS,
  });
}

export function getLatestCheckup(token: string, organizationId: string) {
  return apiFetch<{ checkup: CheckupRecord }>('/api/checkup/latest', {
    token,
    organizationId,
  });
}

export function getCheckupHistory(token: string, organizationId: string, limit = 10) {
  return apiFetch<{ checkups: CheckupRecord[] }>(`/api/checkup/history?limit=${limit}`, {
    token,
    organizationId,
  });
}

export function getCheckupById(token: string, organizationId: string, id: string) {
  return apiFetch<{ checkup: CheckupRecord }>(`/api/checkup/${id}`, {
    token,
    organizationId,
  });
}

export const SOURCE_LABELS: Record<string, string> = {
  google_analytics: 'GA4',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  shopify: 'Shopify',
  general: 'Overall',
};

export const HEALTH_LABELS: Record<CheckupDocument['overallHealth'], string> = {
  good: 'Healthy',
  fair: 'Needs attention',
  weak: 'Weak',
  unknown: 'Unknown',
};
