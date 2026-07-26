import type { Tone } from '@/lib/channels';

export type ThinkingDataSources = {
  analyticsLoaded: boolean;
  googleAdsLoaded: boolean;
  metaAdsLoaded: boolean;
  shopifyLoaded: boolean;
  analyticsReady: boolean;
  googleAdsReady: boolean;
  metaAdsReady: boolean;
  shopifyReady: boolean;
};

export type ThinkingStepView = {
  title: string;
  line: string;
  details: [string, string][];
};

function truncateGoal(goal: string, max = 72): string {
  const t = goal.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function loadedSourceLabels(sources: ThinkingDataSources): string[] {
  const labels: string[] = [];
  if (sources.analyticsLoaded) labels.push('GA4 (Data API)');
  if (sources.googleAdsLoaded) labels.push('Google Ads (Ads API)');
  if (sources.metaAdsLoaded) labels.push('Meta Ads (Marketing API)');
  if (sources.shopifyLoaded) labels.push('Shopify (Admin API)');
  return labels;
}

function skippedSourceLabels(sources: ThinkingDataSources): string[] {
  const labels: string[] = [];
  if (sources.analyticsReady && !sources.analyticsLoaded) labels.push('GA4');
  if (sources.googleAdsReady && !sources.googleAdsLoaded) labels.push('Google Ads');
  if (sources.metaAdsReady && !sources.metaAdsLoaded) labels.push('Meta Ads');
  if (sources.shopifyReady && !sources.shopifyLoaded) labels.push('Shopify');
  return labels;
}

/**
 * Steps shown while POST /api/strategy/create runs.
 * Copy is tied to the user's goal and data sources — not the old bakery demo.
 */
export function buildThinkingSteps(
  goal: string,
  tone: Tone,
  options: ThinkingDataSources & { orgName?: string }
): ThinkingStepView[] {
  const preview = truncateGoal(goal);
  const loaded = loadedSourceLabels(options);
  const skipped = skippedSourceLabels(options);
  const dataSource =
    loaded.length > 0 ? loaded.join(' + ') : 'Web search + benchmarks';

  const readGoal: Record<Tone, string> = {
    expert: `Objective captured: "${preview}"`,
    coach: `I hear you — "${preview}"`,
    peer: `Got it: "${preview}"`,
    pro: `Goal registered: "${preview}"`,
  };

  const analytics: Record<Tone, string> = {
    expert:
      loaded.length > 0
        ? `Loading snapshots: ${dataSource}.`
        : 'No live snapshots available — using web search and benchmarks.',
    coach:
      loaded.length > 0
        ? `Pulling your real numbers (${dataSource})…`
        : 'No connected data loaded yet — I’ll use benchmarks and search.',
    peer:
      loaded.length > 0
        ? `Getting your real numbers (${dataSource})…`
        : 'Couldn’t load live data — falling back to search and benchmarks.',
    pro:
      loaded.length > 0
        ? `Fetching snapshots: ${dataSource}.`
        : 'Snapshot probe returned no sources — generic generation path.',
  };

  const generate: Record<Tone, string> = {
    expert: 'Claude is synthesizing an 8-week JSON plan from your goal and data.',
    coach: 'Building your week-by-week plan with AI…',
    peer: 'Writing your plan — this can take a couple minutes.',
    pro: 'Strategy generation in progress (Claude API).',
  };

  const save: Record<Tone, string> = {
    expert: 'Persisting plan to your workspace database.',
    coach: 'Saving your plan so you can open it anytime.',
    peer: 'Locking it in for your workspace.',
    pro: 'Writing strategy record (Postgres).',
  };

  const workers: Record<Tone, string> = {
    expert: 'Research, Analysis, and Optimization workers produce structured pre-reports.',
    coach: 'Running specialist passes on your data before the main plan…',
    peer: 'Quick research + analysis passes on your numbers…',
    pro: 'Worker pipeline: research → analysis → optimization.',
  };

  const dataDetails: [string, string][] = [
    ['Loaded', loaded.length > 0 ? dataSource : 'None — web search + benchmarks'],
  ];
  if (skipped.length > 0) {
    dataDetails.push(['Skipped', `${skipped.join(', ')} (connected but data unavailable)`]);
  }
  dataDetails.push([
    'Probe',
    loaded.length > 0 ? 'Snapshot health check passed' : 'Check Integrations for data errors',
  ]);

  return [
    {
      title: 'Your goal',
      line: readGoal[tone],
      details: [
        ['Source', 'New plan → your text'],
        ['Workspace', options.orgName ?? 'Current organization'],
      ],
    },
    {
      title: 'Data',
      line: analytics[tone],
      details: dataDetails,
    },
    {
      title: 'Workers',
      line: workers[tone],
      details: [
        ['Research', 'Business profile + emulate list'],
        ['Analysis', loaded.length > 0 ? `${loaded.length} snapshot(s)` : 'Benchmarks only'],
        ['Optimization', 'Ranked channel opportunities'],
      ],
    },
    {
      title: 'Generate',
      line: generate[tone],
      details: [
        ['Service', 'POST /api/strategy/create'],
        ['Model', 'Claude + web search'],
        ['Output', 'Structured 8-week JSON'],
      ],
    },
    {
      title: 'Save',
      line: save[tone],
      details: [
        ['Storage', 'strategies table (per org)'],
        ['Replaces', 'Previous active plan archived'],
      ],
    },
  ];
}
