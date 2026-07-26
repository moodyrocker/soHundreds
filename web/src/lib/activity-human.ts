import type { AutopilotActivityRecord } from '@/lib/autopilot-activity';

/** Collapse noisy duplicate rows for the same plan action + step — keep the latest.
 *  Ask-agent rows (`adhoc-*`) and unique DB ids are never collapsed across runs. */
export function dedupeActivities(activities: AutopilotActivityRecord[]): AutopilotActivityRecord[] {
  const seen = new Map<string, AutopilotActivityRecord>();
  for (const row of activities) {
    const isAdhoc = Boolean(row.actionId?.startsWith('adhoc-'));
    const key = isAdhoc ? row.id : `${row.actionId ?? '_'}:${row.step}`;
    const prev = seen.get(key);
    if (!prev || row.createdAt >= prev.createdAt) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.createdAt > b.createdAt ? 1 : a.createdAt < b.createdAt ? -1 : 0
  );
}

export function sortActivitiesNewestFirst(
  activities: AutopilotActivityRecord[]
): AutopilotActivityRecord[] {
  return [...activities].sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0
  );
}

export type LogEntryMeta = {
  label: string;
  icon: string;
  borderColor: string;
  textColor: string;
};

/** Channel / work-type tags shown as colored chips on each log row. */
export type ActivityTag = {
  id: string;
  label: string;
  /** CSS class: activity-tag--{id} */
  className: string;
};

const TAG_DEFS: ActivityTag[] = [
  { id: 'instagram', label: 'Instagram', className: 'activity-tag--instagram' },
  { id: 'shopify', label: 'Shopify', className: 'activity-tag--shopify' },
  { id: 'meta', label: 'Meta ads', className: 'activity-tag--meta' },
  { id: 'google-ads', label: 'Google Ads', className: 'activity-tag--google-ads' },
  { id: 'email', label: 'Email', className: 'activity-tag--email' },
  { id: 'video', label: 'Video', className: 'activity-tag--video' },
  { id: 'image', label: 'Image', className: 'activity-tag--image' },
  { id: 'seo', label: 'SEO', className: 'activity-tag--seo' },
  { id: 'data', label: 'Data', className: 'activity-tag--data' },
  { id: 'learning', label: 'Learning', className: 'activity-tag--learning' },
  { id: 'agent', label: 'Agent', className: 'activity-tag--agent' },
];

function tagById(id: string): ActivityTag {
  return TAG_DEFS.find((t) => t.id === id) ?? TAG_DEFS[TAG_DEFS.length - 1]!;
}

/** All matching channel tags for a log line (e.g. Instagram + Shopify). */
export function activityTags(item: AutopilotActivityRecord): ActivityTag[] {
  const blob = `${item.title} ${item.detail ?? ''} ${item.step}`.toLowerCase();
  const ids: string[] = [];

  const push = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };

  if (
    blob.includes('instagram') ||
    blob.includes('ig post') ||
    blob.includes('ig feed') ||
    blob.includes('ig story') ||
    blob.includes('ig reel') ||
    /\big\b/.test(blob)
  ) {
    push('instagram');
  }

  if (blob.includes('shopify') || blob.includes('product page') || blob.includes('storefront')) {
    push('shopify');
  }

  if (
    blob.includes('meta ad') ||
    blob.includes('meta ads') ||
    blob.includes('facebook ad') ||
    blob.includes('ad campaign') ||
    blob.includes('paid campaign') ||
    blob.includes('ad spend')
  ) {
    push('meta');
  }

  if (blob.includes('google ads')) {
    push('google-ads');
  }

  if (
    blob.includes('mailchimp') ||
    blob.includes('newsletter') ||
    blob.includes('win-back') ||
    blob.includes('win back') ||
    (blob.includes('email') && !blob.includes('google'))
  ) {
    push('email');
  }

  if (blob.includes('runway') || /\breel\b/.test(blob) || blob.includes('video creat')) {
    push('video');
  }

  if (
    blob.includes('canva') ||
    blob.includes('image created') ||
    blob.includes('generated image') ||
    blob.includes('unsplash') ||
    (blob.includes('image') && (blob.includes('creat') || blob.includes('generat')))
  ) {
    push('image');
  }

  if (blob.includes('seo') || blob.includes('meta title') || blob.includes('meta description')) {
    push('seo');
  }

  if (
    blob.includes('google analytics') ||
    blob.includes('ga4') ||
    item.step.startsWith('data_pull')
  ) {
    push('data');
  }

  if (
    item.step === 'learning_applied' ||
    item.step === 'learning_scored' ||
    item.step === 'learning_patterns' ||
    blob.includes('learning')
  ) {
    push('learning');
  }

  if (ids.length === 0) {
    push('agent');
  }

  return ids.map(tagById);
}

/** @deprecated Prefer activityTags — kept for any single-tag callers. */
export function activityTag(item: AutopilotActivityRecord): ActivityTag {
  return activityTags(item)[0] ?? tagById('agent');
}

export function logEntryMeta(item: AutopilotActivityRecord): LogEntryMeta {
  if (item.status === 'error' || item.step === 'failed' || item.step === 'auto_apply_failed') {
    return {
      label: 'Error',
      icon: '!',
      borderColor: 'rgba(239, 68, 68, 0.7)',
      textColor: 'var(--danger, #ef4444)',
    };
  }
  if (
    item.step === 'complete' ||
    item.step === 'auto_apply_done' ||
    item.step === 'human_confirmed' ||
    item.status === 'success'
  ) {
    const published = /^Published:/i.test(item.title) || /Published /i.test(item.detail ?? '');
    return {
      label: published ? 'Published' : 'Done',
      icon: '✓',
      borderColor: 'rgba(34, 197, 94, 0.7)',
      textColor: 'var(--success, #22c55e)',
    };
  }
  if (
    item.step === 'awaiting_human' ||
    item.step === 'awaiting_confirmation' ||
    item.step === 'checkpoint'
  ) {
    return {
      label: 'Paused',
      icon: '||',
      borderColor: 'rgba(234, 179, 8, 0.7)',
      textColor: 'var(--text-dim)',
    };
  }
  if (item.status === 'running' || item.step === 'executing' || item.step === 'auto_apply') {
    return {
      label: 'Working',
      icon: '→',
      borderColor: 'rgba(99, 102, 241, 0.55)',
      textColor: 'var(--text-dim)',
    };
  }
  return {
    label: 'Update',
    icon: '—',
    borderColor: 'rgba(148, 163, 184, 0.5)',
    textColor: 'var(--text-mute)',
  };
}

export function humanActivityLine(item: AutopilotActivityRecord): string {
  const detail = item.detail?.trim();
  switch (item.step) {
    case 'action_plan':
      return detail
        ? `Planned (not posted yet) — ${detail}`
        : `Planned: ${item.title}`;
    case 'data_pull':
      return detail ? `Pulled live data — ${detail}` : `Pulled live data: ${item.title}`;
    case 'decision':
      return detail ? `Decided approach — ${detail}` : item.title;
    case 'executing':
      return detail ?? `Working on ${item.title.replace(/^Executing: /, '')}…`;
    case 'ai_reasoning':
      return detail ? `Reasoning — ${detail}` : item.title;
    case 'auto_apply':
      return detail ?? 'Applying changes to your account…';
    case 'auto_apply_done': {
      if (/^Published:/i.test(item.title)) {
        return detail ? `${item.title} — ${detail}` : item.title;
      }
      return detail ?? item.title;
    }
    case 'auto_apply_failed':
      return detail ?? 'Could not apply changes automatically.';
    case 'complete': {
      if (/^Published:/i.test(item.title)) {
        return detail && detail !== item.title ? `${item.title} — ${detail}` : item.title;
      }
      return detail ? `Done — ${detail}` : item.title;
    }
    case 'failed':
      return detail ? `Failed — ${detail}` : item.title;
    case 'awaiting_human':
      return detail ?? 'Waiting for you to review a paused ad campaign.';
    case 'human_confirmed':
      return detail ?? 'You confirmed — continuing to the next action.';
    case 'checkpoint':
      return detail ?? 'Batch complete — reviewing results before the next set of actions.';
    case 'agent_task':
      return detail ?? item.title;
    case 'continuous':
      return detail ? `Goal cycle — ${detail}` : item.title;
    case 'week_reasoning':
      return detail ?? 'Planned the next set of actions from your goal and live data.';
    case 'learning_applied':
      return detail ?? item.title;
    default:
      return detail ? `${item.title} — ${detail}` : item.title;
  }
}

/** Split a log line into text + clickable URL segments. */
export function linkifyActivityParts(
  text: string
): Array<{ type: 'text' | 'link'; value: string }> {
  const parts: Array<{ type: 'text' | 'link'; value: string }> = [];
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let url = match[0];
    const index = match.index;
    if (index > last) {
      parts.push({ type: 'text', value: text.slice(last, index) });
    }
    let trailing = '';
    while (/[.,;:!?)]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    parts.push({ type: 'link', value: url });
    if (trailing) parts.push({ type: 'text', value: trailing });
    last = index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', value: text.slice(last) });
  }
  return parts.length ? parts : [{ type: 'text', value: text }];
}

export function isTerminalActivityStep(step: string): boolean {
  return step === 'complete' || step === 'failed' || step === 'checkpoint' || step === 'skipped';
}

/** Coarse buckets for the activity log filter chips. */
export type ActivityLogFilter =
  | 'all'
  | 'results'
  | 'published'
  | 'done'
  | 'planning'
  | 'working'
  | 'errors';

export type ActivityLogBucket =
  | 'published'
  | 'done'
  | 'planning'
  | 'working'
  | 'errors'
  | 'paused'
  | 'update';

const PLANNING_STEPS = new Set([
  'action_plan',
  'week_reasoning',
  'decision',
  'ai_reasoning',
  'continuous',
  'data_pull',
  'agent_task',
]);

export function activityLogBucket(item: AutopilotActivityRecord): ActivityLogBucket {
  const meta = logEntryMeta(item);
  if (meta.label === 'Error') return 'errors';
  if (meta.label === 'Published') return 'published';
  if (meta.label === 'Done') return 'done';
  if (meta.label === 'Working') return 'working';
  if (meta.label === 'Paused') return 'paused';
  if (PLANNING_STEPS.has(item.step)) return 'planning';
  if (/planned|planning|next set of actions|goal cycle/i.test(`${item.title} ${item.detail ?? ''}`)) {
    return 'planning';
  }
  return 'update';
}

export function activityMatchesLogFilter(
  item: AutopilotActivityRecord,
  filter: ActivityLogFilter
): boolean {
  if (filter === 'all') return true;
  const bucket = activityLogBucket(item);
  if (filter === 'results') return bucket === 'published' || bucket === 'done';
  return bucket === filter;
}

export const ACTIVITY_LOG_FILTERS: Array<{ id: ActivityLogFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'results', label: 'Published & done' },
  { id: 'published', label: 'Published' },
  { id: 'done', label: 'Done' },
  { id: 'planning', label: 'Planning' },
  { id: 'working', label: 'Working' },
  { id: 'errors', label: 'Errors' },
];
