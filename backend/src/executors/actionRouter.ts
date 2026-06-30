import type { PlanAction } from '../types/plan.js';
import type { ExecutionRoute } from '../types/execution.js';

export type OrgIntegrationFlags = {
  shopify: boolean;
  shopifyWrite: boolean;
  shopifyContentWrite: boolean;
  metaAds: boolean;
  metaAdsReady: boolean;
  googleAds: boolean;
  googleAdsReady: boolean;
  analytics: boolean;
};

export type ActionIntent =
  | 'product_seo'
  | 'shopify_page'
  | 'shopify_blog'
  | 'google_ads_campaign'
  | 'meta_ads_campaign'
  | 'assist';

function actionBlob(action: PlanAction): string {
  return `${action.title} ${action.outcome} ${action.kpi} ${action.why}`.toLowerCase();
}

function mentionsMetaAds(blob: string): boolean {
  const signals = [
    'meta ads',
    'meta ad',
    'meta campaign',
    'meta test',
    'meta (',
    'facebook ads',
    'instagram ads',
    'instagram + facebook',
    'facebook + instagram',
    'fb ads',
    'paid social',
    'adsmanager',
    'ads manager',
  ];
  if (signals.some((s) => blob.includes(s))) return true;
  if (/\bmeta\b/.test(blob) && /campaign|ads|budget|targeting|spend|ad set/.test(blob)) {
    return true;
  }
  return /instagram/.test(blob) && /facebook/.test(blob) && /campaign|ads|budget|targeting/.test(blob);
}

function mentionsGoogleAds(blob: string): boolean {
  const signals = [
    'google ads',
    'google ad',
    'paid search',
    'search campaign',
    'ppc',
    'google search',
    'google campaign',
    'launch google',
    'set up google ads',
    'create google ads',
    'google advertising',
    'adwords',
  ];
  return signals.some((s) => blob.includes(s));
}

function isPaidAdCampaignContext(action: PlanAction, blob: string): boolean {
  if (action.channel === 'paid') return true;
  return /test campaign|ad campaign|campaign live|daily budget|ad spend|targeting:|ad set|ad copy/.test(
    blob
  );
}

export function isAdvertPlanAssist(action: PlanAction): boolean {
  const blob = actionBlob(action);
  if (mentionsMetaAds(blob) || mentionsGoogleAds(blob)) return false;
  return action.channel === 'paid';
}

export function classifyActionIntent(action: PlanAction): ActionIntent {
  const blob = actionBlob(action);

  // Tag managers, analytics, pixels — setup guides, never Shopify page writes.
  const integrationSetupSignals = [
    'google analytics',
    'ga4',
    'ga 4',
    'analytics event',
    'event tracking',
    'google tag manager',
    'gtm',
    'conversion tracking',
    'tracking code',
    'tracking setup',
    'meta pixel',
    'facebook pixel',
    'install pixel',
    'measurement id',
    'data layer',
    'search console',
    'hotjar',
    'clarity',
  ];
  if (integrationSetupSignals.some((s) => blob.includes(s))) {
    return 'assist';
  }

  const mentionsMeta = mentionsMetaAds(blob);
  const mentionsGoogle = mentionsGoogleAds(blob);

  // Paid ads — before page/blog/SEO signals (outcomes often mention "landing page" as ad URL only).
  if (mentionsMeta) {
    return 'meta_ads_campaign';
  }

  if (
    !mentionsMeta &&
    (mentionsGoogle || (action.channel === 'paid' && /google|search|ppc/.test(blob)))
  ) {
    return 'google_ads_campaign';
  }

  if (isPaidAdCampaignContext(action, blob)) {
    return 'assist';
  }

  const pageWriteSignals = [
    'landing page',
    'store page',
    'shopify page',
    'create page',
    'write page',
    'new page',
    'content page',
    'about page',
    'faq page',
    'service page',
    'publish page',
    'build page',
    'add page',
    'page for',
    'pages for',
    'blog page',
    'seo page',
  ];

  if (pageWriteSignals.some((s) => blob.includes(s))) {
    return 'shopify_page';
  }

  const blogContentSignals = [
    'content calendar',
    'blog calendar',
    'blog post',
    'blog article',
    'blog content',
    'blog series',
    'publish blog',
    'write blog',
    'create blog',
    'articles for',
    'week content',
    '-week content',
    'blog posts',
  ];

  if (blogContentSignals.some((s) => blob.includes(s))) {
    return 'shopify_blog';
  }

  const seoWriteSignals = [
    'meta title',
    'meta description',
    'seo title',
    'seo description',
    'product seo',
    'optimize product',
    'update product title',
    'update product description',
    'rewrite product',
    'product listing',
    'shopify seo',
  ];

  if (seoWriteSignals.some((s) => blob.includes(s))) {
    return 'product_seo';
  }

  const assistSignals = [
    'audit',
    'analyze',
    'analysis',
    'analyse',
    'research',
    'review',
    'checklist',
    'report',
    'setup',
    'configure',
    'strategy doc',
    'calendar',
    'schedule',
    'instagram',
    'email',
    'campaign',
    'ad copy',
    'google business',
    'local listing',
    'free tool',
    'keyword research',
    'content plan',
    'brief',
  ];

  if (assistSignals.some((s) => blob.includes(s))) {
    return 'assist';
  }

  if (action.channel === 'instagram' || action.channel === 'email' || action.channel === 'paid' || action.channel === 'local') {
    return 'assist';
  }

  if (action.channel === 'seo' || action.channel === 'content') {
    if (/blog|article|content calendar|blog post/.test(blob)) {
      return 'shopify_blog';
    }
    if (
      /landing page|store page|shopify page|about page|faq page|service page|content page|create (a )?page|new page|write (a )?page|build (a )?page|publish (a )?page|add (a )?page/.test(
        blob
      )
    ) {
      return 'shopify_page';
    }
    if (/product|sku|listing|shopify/.test(blob) && /title|description|meta|seo/.test(blob)) {
      return 'product_seo';
    }
    return 'assist';
  }

  return 'assist';
}

/** Plain-English explanation of the routing decision (shown in autopilot activity feed). */
export function explainActionRoute(
  action: PlanAction,
  integrations: OrgIntegrationFlags
): string {
  const intent = classifyActionIntent(action);

  if (intent === 'shopify_page' && integrations.shopify) {
    if (integrations.shopifyContentWrite) {
      return `This action creates a Shopify store page — Hundres will draft full page copy and can publish it as a draft in your store for "${action.title}".`;
    }
    return `Store page preview only — Hundres will draft copy and a Claude.ai + Shopify MCP prompt you can paste to create the page (write_content not granted yet).`;
  }

  if (intent === 'shopify_blog' && integrations.shopify) {
    if (integrations.shopifyContentWrite) {
      return `Blog/content action for Shopify — Hundres will draft the full calendar or article copy; publish via approve when write_content is active.`;
    }
    return `Content calendar for Shopify blog — Hundres drafts the full plan here plus a Claude.ai + Shopify MCP prompt to create each blog post as a draft (write_content not granted yet).`;
  }

  if (intent === 'shopify_blog') {
    return `Blog content calendar — connect Shopify in Integrations, then use the Claude.ai MCP prompt to publish posts. Hundres will draft the calendar copy for "${action.title}".`;
  }

  if (intent === 'product_seo' && integrations.shopify) {
    if (integrations.shopifyWrite) {
      return `This action targets product SEO in Shopify — Hundres will draft and can apply title and meta description for "${action.title}".`;
    }
    return `Product SEO preview only — connect Shopify write access to auto-apply. For now Hundres prepares the copy for "${action.title}".`;
  }

  if (intent === 'meta_ads_campaign') {
    if (integrations.metaAdsReady) {
      return `Meta Ads campaign — Hundres drafts a full Facebook/Instagram campaign for "${action.title}". Review here, then approve to create it paused in your account. You turn it on in Meta Ads Manager when ready — Hundres never starts spend automatically.`;
    }
    if (integrations.metaAds) {
      return `Meta Ads is connected but no ad account selected — pick your account in Integrations, then Hundres can create paused campaigns for "${action.title}".`;
    }
    return `Meta Ads campaign — connect Meta in Integrations to create paused campaigns. For now Hundres prepares an advert plan for "${action.title}".`;
  }

  if (intent === 'google_ads_campaign') {
    if (integrations.googleAdsReady) {
      return `Google Ads campaign setup — Hundres will draft a full Search campaign (budget, keywords, ad copy) for "${action.title}". Review here, then approve to create it paused in your account. You turn it on in Google Ads when ready — Hundres never starts spend automatically.`;
    }
    if (integrations.googleAds) {
      return `Google Ads is connected but no account selected — pick your Ads account in Integrations, then Hundres can draft and create paused campaigns for "${action.title}".`;
    }
    return `Google Ads campaign — connect Google Ads in Integrations to draft and create paused campaigns. For now Hundres prepares ad copy and setup steps for "${action.title}".`;
  }

  if (intent === 'assist' && isAdvertPlanAssist(action)) {
    return `Advert plan — Hundres builds a full campaign brief (budget, audience, ad copy, launch steps) for "${action.title}". You create and start the campaign in Meta or Google Ads Manager yourself.`;
  }

  if (intent === 'assist') {
    const channelNote =
      action.channel === 'paid'
        ? 'Paid actions need your approval before anything goes live in ad platforms.'
        : action.channel === 'local'
          ? 'Local listings are prepared as steps and copy for you to publish.'
          : 'Hundres generates ready-to-use copy — nothing is published without you.';

    if (/audit|research|analyze|analyse|review|checklist|free tool|tracking|analytics|pixel|gtm/i.test(action.title)) {
      return `Research/audit or integration setup — deliverable is a checklist and steps, not a store page. ${channelNote}`;
    }
    return `${channelNote} Focus: ${action.outcome || action.title}.`;
  }

  return `Prepare "${action.title}" as an assist deliverable.`;
}

export function resolveActionRoute(
  action: PlanAction,
  integrations: OrgIntegrationFlags
): ExecutionRoute {
  const intent = classifyActionIntent(action);

  if (intent === 'shopify_page' && integrations.shopify) {
    return {
      mode: 'automated_write',
      executionType: 'create_shopify_page',
      platform: 'shopify',
      riskLevel: 'low',
      summary: integrations.shopifyContentWrite
        ? `Create Shopify page (draft) for "${action.title}".`
        : `Preview Shopify page for "${action.title}" (write_content scope pending).`,
    };
  }

  if (intent === 'shopify_blog') {
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: integrations.shopify ? 'shopify' : 'hundres',
      riskLevel: 'low',
      summary: integrations.shopify
        ? integrations.shopifyContentWrite
          ? `Draft Shopify blog content for "${action.title}".`
          : `Draft blog calendar + Claude.ai Shopify MCP prompt for "${action.title}".`
        : `Generate blog content calendar for "${action.title}".`,
    };
  }

  if (intent === 'assist' && isAdvertPlanAssist(action)) {
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: 'hundres',
      riskLevel: 'medium',
      summary: `Build advert plan for "${action.title}" — budget, targeting, and ad copy ready for Ads Manager.`,
    };
  }

  if (intent === 'product_seo' && integrations.shopify) {
    return {
      mode: 'automated_write',
      executionType: 'update_product_seo',
      platform: 'shopify',
      riskLevel: 'low',
      summary: integrations.shopifyWrite
        ? `Apply SEO update in Shopify for "${action.title}".`
        : `Preview Shopify SEO change for "${action.title}" (write scope pending).`,
    };
  }

  if (intent === 'meta_ads_campaign') {
    if (integrations.metaAdsReady) {
      return {
        mode: 'automated_write',
        executionType: 'create_meta_ads_campaign',
        platform: 'meta_ads',
        riskLevel: 'medium',
        summary: `Draft Meta campaign for "${action.title}" — approve to create paused in your account.`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: 'hundres',
      riskLevel: 'medium',
      summary: `Build advert plan for "${action.title}" (connect Meta Ads to create campaigns automatically).`,
    };
  }

  if (intent === 'google_ads_campaign') {
    if (integrations.googleAdsReady) {
      return {
        mode: 'automated_write',
        executionType: 'create_google_ads_campaign',
        platform: 'google_ads',
        riskLevel: 'medium',
        summary: `Draft Google Search campaign for "${action.title}" — approve to create paused in your account.`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: 'hundres',
      riskLevel: 'medium',
      summary: `Prepare Google Ads setup guide and ad copy for "${action.title}" (connect Google Ads to create campaigns).`,
    };
  }

  const channelLabels: Record<string, string> = {
    instagram: 'Instagram post',
    email: 'Email campaign',
    seo: 'SEO task',
    content: 'Content piece',
    paid: 'Paid ads',
    local: 'Local marketing',
  };

  return {
    mode: 'assist',
    executionType: 'assist_deliverable',
    platform: 'hundres',
    riskLevel: action.channel === 'paid' ? 'medium' : 'low',
    summary: `Generate ready-to-use ${channelLabels[action.channel] ?? 'marketing'} deliverable for "${action.title}".`,
  };
}

export function isAutomatedWrite(route: ExecutionRoute): boolean {
  return (
    route.mode === 'automated_write' &&
    (route.executionType === 'update_product_seo' ||
      route.executionType === 'create_shopify_page' ||
      route.executionType === 'create_google_ads_campaign' ||
      route.executionType === 'create_meta_ads_campaign')
  );
}
