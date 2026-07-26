import type { AssistDeliverable, ExecutionRecord } from '@/lib/execution';
import { isAssistDeliverable } from '@/lib/execution';

const EXTRA_ORDER = [
  'platform',
  'objective',
  'dailyBudget',
  'totalBudget',
  'duration',
  'audience',
  'placements',
  'headline',
  'adPrimaryText1',
  'adPrimaryText2',
  'adPrimaryText3',
  'cta',
  'landingUrl',
] as const;

const EXTRA_LABELS: Record<string, string> = {
  platform: 'Platform',
  objective: 'Objective',
  dailyBudget: 'Daily budget',
  totalBudget: 'Total budget',
  duration: 'Duration',
  audience: 'Audience',
  placements: 'Placements',
  headline: 'Headline',
  adPrimaryText1: 'Ad copy — variant 1',
  adPrimaryText2: 'Ad copy — variant 2',
  adPrimaryText3: 'Ad copy — variant 3',
  cta: 'Call to action',
  landingUrl: 'Landing page',
};

export function isAdvertPlanAction(channel: string, execution: ExecutionRecord | null): boolean {
  if (execution?.executionType === 'create_google_ads_campaign') return false;
  if (execution?.executionType === 'create_meta_ads_campaign') return false;
  if (channel.toLowerCase().includes('paid') && execution?.executionType === 'assist_deliverable') {
    return true;
  }
  if (!execution || !isAssistDeliverable(execution.proposedState)) return false;
  const keys = Object.keys(execution.proposedState.extras).map((k) => k.toLowerCase());
  return keys.some((k) =>
    /budget|audience|objective|adprimary|platform|targeting|placements/.test(k)
  );
}

export function orderedAdvertPlanExtras(extras: Record<string, string>): Array<[string, string]> {
  const used = new Set<string>();
  const rows: Array<[string, string]> = [];

  for (const key of EXTRA_ORDER) {
    const value = extras[key];
    if (value?.trim()) {
      rows.push([key, value]);
      used.add(key);
    }
  }

  for (const [key, value] of Object.entries(extras)) {
    if (!used.has(key) && value.trim()) {
      rows.push([key, value]);
    }
  }

  return rows;
}

export function advertPlanExtraLabel(key: string): string {
  return EXTRA_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function formatAdvertPlanForCopy(assist: AssistDeliverable): string {
  const sections: string[] = [`ADVERT PLAN: ${assist.headline}`, ''];

  if (assist.primaryCopy.trim()) {
    sections.push('OVERVIEW', assist.primaryCopy, '');
  }

  const extras = orderedAdvertPlanExtras(assist.extras);
  if (extras.length > 0) {
    sections.push('CAMPAIGN SETUP');
    for (const [key, value] of extras) {
      sections.push(`${advertPlanExtraLabel(key)}: ${value}`);
    }
    sections.push('');
  }

  if (assist.steps.length > 0) {
    sections.push('LAUNCH CHECKLIST');
    assist.steps.forEach((step, i) => sections.push(`${i + 1}. ${step}`));
    sections.push('');
  }

  if (assist.pasteInstructions.trim()) {
    sections.push(`WHERE TO BUILD: ${assist.pasteInstructions}`);
  }

  return sections.join('\n');
}
