export type MetricKey =
  | 'revenue'
  | 'orders'
  | 'sessions'
  | 'activeUsers'
  | 'engagementRate'
  | 'instagramEngagementRate';

export function parseNumeric(value: string | undefined | null): number | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();

  const pctMatch = trimmed.match(/([\d,.]+)\s*%/);
  if (pctMatch) {
    const n = Number(pctMatch[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  const embedded = trimmed.match(/([\d,.]+)/);
  if (embedded) {
    const n = Number(embedded[1].replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }

  return null;
}

export function resolveMetricKey(metricLabel: string, unit?: string | null): MetricKey {
  const s = `${metricLabel} ${unit ?? ''}`.toLowerCase();
  if (/instagram|\big\b/.test(s) && /engagement|like|comment|save/.test(s)) {
    return 'instagramEngagementRate';
  }
  if (/revenue|sales|gmv|turnover|income/.test(s)) return 'revenue';
  if (/order|transaction|purchase|checkout/.test(s)) return 'orders';
  if (/session|traffic|visit|pageview/.test(s)) return 'sessions';
  if (/user|visitor|audience/.test(s)) return 'activeUsers';
  if (/conversion|engagement|rate/.test(s)) return 'engagementRate';
  return 'revenue';
}

function isAbsoluteRateTarget(targetStr: string, goalLine?: string): boolean {
  if (!/%/.test(targetStr)) return false;
  if (/increase|grow|lift|boost|raise|improve\s+by/i.test(goalLine ?? '')) return false;
  return /%\+?$/.test(targetStr.trim()) || /\d\s*%\+/.test(targetStr);
}

export function resolveTargetValue(
  baseline: number,
  targetStr: string,
  goalLine?: string
): number | null {
  const target = parseNumeric(targetStr);
  if (target === null) return null;

  if (isAbsoluteRateTarget(targetStr, goalLine)) {
    return target;
  }

  const relativeHint =
    /\+?\d+\s*%/.test(targetStr) ||
    /\+?\d+\s*%/.test(goalLine ?? '') ||
    (target <= 200 && /increase|grow|lift|boost|raise|\+/i.test(goalLine ?? ''));

  if (relativeHint && target <= 200) {
    return baseline * (1 + target / 100);
  }
  return target;
}

export function parseShopifySnapshotText(text: string): {
  orders?: number;
  revenue?: number;
} {
  const ordersMatch = text.match(/Orders:\s*(\d+)/i);
  const revenueMatch = text.match(/Revenue[^$£]*[$£]([\d,.]+)/i);
  return {
    orders: ordersMatch ? Number(ordersMatch[1]) : undefined,
    revenue: revenueMatch ? Number(revenueMatch[1].replace(/,/g, '')) : undefined,
  };
}

export function parseGaSnapshotText(text: string): {
  sessions?: number;
  activeUsers?: number;
  engagementRate?: number;
} {
  const sessionsMatch = text.match(/sessions:\s*([\d.]+)/i);
  const usersMatch = text.match(/activeUsers:\s*([\d.]+)/i);
  const engagementMatch = text.match(/engagementRate:\s*([\d.]+)%?/i);
  return {
    sessions: sessionsMatch ? Number(sessionsMatch[1]) : undefined,
    activeUsers: usersMatch ? Number(usersMatch[1]) : undefined,
    engagementRate: engagementMatch ? Number(engagementMatch[1]) : undefined,
  };
}

export function pickMetricValue(
  key: MetricKey,
  shopify: ReturnType<typeof parseShopifySnapshotText>,
  ga: ReturnType<typeof parseGaSnapshotText>,
  instagram?: { engagementRate?: number }
): { value: number | null; source: string | null } {
  switch (key) {
    case 'revenue':
      return shopify.revenue != null
        ? { value: shopify.revenue, source: 'shopify' }
        : { value: null, source: null };
    case 'orders':
      return shopify.orders != null
        ? { value: shopify.orders, source: 'shopify' }
        : { value: null, source: null };
    case 'sessions':
      return ga.sessions != null ? { value: ga.sessions, source: 'google_analytics' } : { value: null, source: null };
    case 'activeUsers':
      return ga.activeUsers != null
        ? { value: ga.activeUsers, source: 'google_analytics' }
        : { value: null, source: null };
    case 'engagementRate':
      return ga.engagementRate != null
        ? { value: ga.engagementRate, source: 'google_analytics' }
        : { value: null, source: null };
    case 'instagramEngagementRate':
      return instagram?.engagementRate != null
        ? { value: instagram.engagementRate, source: 'instagram' }
        : { value: null, source: null };
    default:
      return { value: null, source: null };
  }
}
