import type { PlanAction } from '../types/plan.js';
import type { ExecutionRoute } from '../types/execution.js';
import { isGoogleAdsEnabled } from '../lib/googleFeatureFlags.js';
import {
  isInstagramAutoPublishEnabled,
  isShopifyAutoPublishLiveEnabled,
} from '../lib/contentPublishFeatureFlags.js';

export type OrgIntegrationFlags = {
  shopify: boolean;
  shopifyWrite: boolean;
  shopifyContentWrite: boolean;
  metaAds: boolean;
  metaAdsReady: boolean;
  googleAds: boolean;
  googleAdsReady: boolean;
  analytics: boolean;
  canva: boolean;
  canvaReady: boolean;
  runway: boolean;
  runwayReady: boolean;
  instagram: boolean;
  instagramReady: boolean;
  mailchimp: boolean;
  mailchimpReady: boolean;
};

export type ActionIntent =
  | 'product_seo'
  | 'shopify_page'
  | 'shopify_blog'
  | 'instagram_publish'
  | 'instagram_story'
  | 'instagram_reel'
  | 'google_ads_campaign'
  | 'meta_ads_campaign'
  | 'mailchimp_campaign'
  | 'assist';

function actionBlob(action: PlanAction): string {
  return `${action.title} ${action.outcome} ${action.kpi} ${action.why}`.toLowerCase();
}

function mentionsMetaAds(blob: string): boolean {
  // Organic Instagram posting must never be treated as paid Meta ads.
  if (isOrganicInstagramPublishBlob(blob)) return false;

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
    'paid post',
    'paid social post',
    'test campaign',
    'small test campaign',
    'launch small test',
    'adsmanager',
    'ads manager',
  ];
  if (signals.some((s) => blob.includes(s))) return true;
  if (/\bmeta\b/.test(blob) && /campaign|ads|budget|targeting|spend|ad set/.test(blob)) {
    return true;
  }
  // Instagram/Facebook paid campaigns — require a clear paid signal (not just "campaign"
  // in an outcome that also mentions Instagram organic posts).
  if (
    /\b(instagram|facebook|fb|meta)\b/.test(blob) &&
    /\b(paid|ads manager|ad spend|daily budget|ad set|adsmanager|£\d|\$\d|€\d)\b/.test(blob)
  ) {
    return true;
  }
  if (
    /\b(instagram|facebook|fb)\b/.test(blob) &&
    /\bads\b/.test(blob) &&
    !/feed post|film\s*\+|create and publish|organic post|carousel/.test(blob)
  ) {
    return true;
  }
  return false;
}

/** True when the action is clearly organic Instagram content creation/publishing. */
function isOrganicInstagramPublishBlob(blob: string): boolean {
  const organicVerb =
    /film\s*\+\s*publish|create and publish|publish\b.*\b(instagram|feed|carousel|story|reel)|instagram (feed|post|carousel|story|reel)|feed post|carousel post|\bcarousel\b.*\binstagram|instagram.*\bcarousel/.test(
      blob
    );
  if (!organicVerb && !/\binstagram\b/.test(blob)) return false;
  if (!organicVerb) return false;
  // Explicit paid overrides organic phrasing.
  if (
    /\b(meta ads|instagram ads|facebook ads|paid social|paid post|ad spend|daily budget|ads manager)\b/.test(
      blob
    ) ||
    /£\d|\$\d|€\d/.test(blob)
  ) {
    return false;
  }
  return true;
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
  if (mentionsMetaAds(blob) || mentionsGoogleAds(blob)) return false;
  if (action.channel === 'paid') return true;
  return /test campaign|ad campaign|campaign live|daily budget|ad spend|targeting:|ad set|ad copy/.test(
    blob
  );
}

/** Email sequences / list-building — Mailchimp drafts when connected. */
function isMailchimpEmailAction(action: PlanAction, blob: string): boolean {
  if (action.channel === 'email') return true;
  const signals = [
    'email sequence',
    'email campaign',
    'win-back',
    'winback',
    'mailing list',
    'list-building',
    'list building',
    'newsletter',
    'drip email',
    'drip campaign',
    'mailchimp',
    'sms list',
    're-engagement email',
    'welcome email',
  ];
  return signals.some((s) => blob.includes(s));
}

export function isAdvertPlanAssist(action: PlanAction): boolean {
  const blob = actionBlob(action);
  if (mentionsMetaAds(blob) || mentionsGoogleAds(blob)) return false;
  return action.channel === 'paid';
}

export function isInstagramReelOrVideo(action: PlanAction): boolean {
  const blob = actionBlob(action);
  // Explicit feed / carousel / multi-slide stills always win — plan outcomes often
  // mention "video views" or "Reels reach" as KPIs without meaning a Reel post.
  if (
    /\bfeed post(s)?\b|instagram feed|instagram carousel|carousel post|\bcarousel\b|\b\d[\d-]?\s*slides?\b|\b\d+-slide\b/.test(
      blob
    )
  ) {
    return false;
  }
  return /\breels?\b|ugc|\bvideo\b|runway|ai video|text.to.video/.test(blob);
}

export function isInstagramStoryAction(action: PlanAction): boolean {
  const blob = actionBlob(action);
  if (isInstagramReelOrVideo(action) && !/\bstor(y|ies)\b/.test(blob)) return false;
  return (
    /\binstagram stor|\bpost\b.*\bstor(y|ies)\b|\bpublish\b.*\bstor(y|ies)\b|\bstor(y|ies)\b/.test(
      blob
    ) && !/storyboard|brand story|success story|user story/.test(blob)
  );
}

/** Organic Instagram feed / carousel (not Stories, Reels, or paid ads). */
export function isInstagramFeedPostAction(action: PlanAction): boolean {
  const blob = actionBlob(action);
  if (mentionsMetaAds(blob)) return false;
  if (isInstagramStoryAction(action)) return false;
  if (isInstagramReelOrVideo(action)) return false;
  if (isOrganicInstagramPublishBlob(blob) && !/\bstor(y|ies)\b|\breels?\b/.test(blob)) {
    return true;
  }
  if (action.channel === 'instagram') return true;
  return (
    /instagram post|feed post|instagram feed|carousel post|instagram carousel|\bcarousel\b/.test(
      blob
    ) ||
    (/instagram/.test(blob) &&
      /create and publish|film\s*\+\s*publish|publish|post|slide|carousel|photo|image/.test(blob) &&
      !/shopify page|store page|landing page|product seo/.test(blob))
  );
}

export function isSingleShopifyBlogPost(action: PlanAction): boolean {
  const blob = actionBlob(action);
  return /one blog|single blog|one published blog|one article|publish one blog|1 blog post|one high-intent blog/.test(
    blob
  );
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

  // Organic Instagram posting BEFORE paid-ad heuristics — outcomes often say "campaign"
  // while the title is "Film + publish Instagram feed posts".
  if (isInstagramStoryAction(action)) {
    return 'instagram_story';
  }

  if (isInstagramReelOrVideo(action)) {
    return 'instagram_reel';
  }

  if (isInstagramFeedPostAction(action)) {
    return 'instagram_publish';
  }

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

  // (Instagram already handled above.)

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
    'blog page',
    'seo page',
  ];

  if (pageWriteSignals.some((s) => blob.includes(s))) {
    return 'shopify_page';
  }

  // Narrow "page for / pages for" — only when clearly a store/content page, not social copy.
  if (
    (/\bpages? for\b/.test(blob) || /\b(create|write|build|publish|add) (a )?pages?\b/.test(blob)) &&
    !/instagram|carousel|reel|story|feed post/.test(blob)
  ) {
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

  if (isMailchimpEmailAction(action, blob)) {
    return 'mailchimp_campaign';
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
    return action.channel === 'email' ? 'mailchimp_campaign' : 'assist';
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
      const live = isShopifyAutoPublishLiveEnabled();
      return `This action creates a Shopify store page — Hundres will draft full page copy and publish it ${live ? 'live' : 'as a draft'} in your store for "${action.title}".`;
    }
    return `Store page preview only — Hundres will draft copy and a Claude.ai + Shopify MCP prompt you can paste to create the page (write_content not granted yet).`;
  }

  if (intent === 'shopify_blog' && integrations.shopify) {
    if (isSingleShopifyBlogPost(action) && integrations.shopifyContentWrite) {
      const live = isShopifyAutoPublishLiveEnabled();
      return `Blog article for Shopify — Hundres will draft and auto-publish ${live ? 'live' : 'as a draft'} for "${action.title}".`;
    }
    if (integrations.shopifyContentWrite) {
      return `Blog/content action for Shopify — Hundres will draft the full calendar or article copy; publish via approve when write_content is active.`;
    }
    return `Content calendar for Shopify blog — Hundres drafts the full plan here plus a Claude.ai + Shopify MCP prompt to create each blog post as a draft (write_content not granted yet).`;
  }

  if (intent === 'instagram_story') {
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady) {
      return `Instagram story — Hundres will pick an image (or use your video URL) and publish to Stories for "${action.title}". Stories disappear after 24 hours.`;
    }
    if (!integrations.instagram) {
      return `Instagram story — connect Instagram Business in Integrations to auto-publish; until then Hundres prepares an image preview for "${action.title}".`;
    }
    return `Instagram story — Hundres will create the story asset and publish for "${action.title}".`;
  }

  if (intent === 'instagram_reel') {
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady && integrations.runwayReady) {
      return `Instagram Reel — Hundres will generate AI video with Runway (5s, lowest credit) and publish the Reel for "${action.title}".`;
    }
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady) {
      return `Instagram Reel — add RUNWAY_API_KEY so the agent can generate AI video for "${action.title}".`;
    }
    if (!integrations.instagram) {
      return `Instagram Reel — connect Instagram + Runway so the agent can generate and publish for "${action.title}".`;
    }
    return `Instagram Reel — the agent will generate AI video (Runway) and publish for "${action.title}".`;
  }

  if (intent === 'instagram_publish') {
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady) {
      const carousel = /\bcarousel\b|\b\d[\d-]?\s*slides?\b|\b\d+-slide\b/.test(actionBlob(action));
      if (integrations.canvaReady) {
        return carousel
          ? `Instagram carousel — Hundres will generate slide images, write the caption, and publish a multi-image post for "${action.title}".`
          : `Instagram feed post — Hundres can create/export in Canva, write the caption, and publish automatically for "${action.title}".`;
      }
      return carousel
        ? `Instagram carousel — Hundres will generate AI stills (Runway), write the caption, and publish a multi-image post for "${action.title}".`
        : `Instagram feed post — Hundres will pick an on-brand image, write the caption, and publish automatically to your connected account for "${action.title}".`;
    }
    if (!integrations.instagram) {
      return `Instagram post — connect Instagram Business in Integrations to auto-publish; until then Hundres prepares caption and image preview for "${action.title}".`;
    }
    return `Instagram post — enable INSTAGRAM_AUTO_PUBLISH and connect Instagram so the agent can publish for "${action.title}".`;
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
      return `Meta Ads campaign — Hundres creates a paused campaign in your account for "${action.title}". You turn it on in Meta Ads Manager when ready — Hundres never starts spend automatically.`;
    }
    if (integrations.metaAds) {
      return `Meta Ads is connected but no ad account selected — pick your account in Integrations, then Hundres can create paused campaigns for "${action.title}".`;
    }
    return `Meta Ads campaign — connect Meta in Integrations to create paused campaigns. For now Hundres prepares an advert plan for "${action.title}".`;
  }

  if (intent === 'google_ads_campaign') {
    if (integrations.googleAdsReady) {
      return `Google Ads campaign setup — Hundres creates a paused Search campaign (budget, keywords, ad copy) for "${action.title}". You turn it on in Google Ads when ready — Hundres never starts spend automatically.`;
    }
    if (integrations.googleAds) {
      return `Google Ads is connected but no account selected — pick your Ads account in Integrations, then Hundres can draft and create paused campaigns for "${action.title}".`;
    }
    return `Google Ads campaign — connect Google Ads in Integrations to draft and create paused campaigns. For now Hundres prepares ad copy and setup steps for "${action.title}".`;
  }

  if (intent === 'mailchimp_campaign') {
    if (integrations.mailchimpReady) {
      return `Email sequence — Hundres will draft copy and create Mailchimp campaign drafts for "${action.title}". Nothing is sent until you review and send in Mailchimp.`;
    }
    if (integrations.mailchimp) {
      return `Mailchimp is connected but no audience selected — pick a default list in Integrations, then Hundres can create draft campaigns for "${action.title}".`;
    }
    return `Email sequence — connect Mailchimp in Integrations to create audience + draft campaigns. Until then Hundres prepares copy you can paste into your ESP for "${action.title}".`;
  }

  if (intent === 'assist' && isAdvertPlanAssist(action)) {
    if (integrations.metaAdsReady) {
      return `Meta Ads campaign — Hundres will create a paused campaign in your Meta account for "${action.title}". You turn it on in Ads Manager when ready — nothing spends until you enable it.`;
    }
    if (integrations.googleAdsReady) {
      return `Google Ads campaign — Hundres will create a paused Search campaign in your Google Ads account for "${action.title}". You enable spending in Google Ads when ready.`;
    }
    return `Advert plan — connect Meta Ads in Integrations so Hundres can create paused campaigns for "${action.title}". Until then, you get a brief to paste into Ads Manager yourself.`;
  }

  if (intent === 'assist') {
    const channelNote =
      action.channel === 'paid'
        ? 'Paid actions need your approval before anything goes live in ad platforms.'
        : action.channel === 'local'
          ? 'Local listings are prepared as steps and copy for you to publish.'
          : action.channel === 'email'
            ? integrations.mailchimpReady
              ? 'Email drafts go to Mailchimp — you review and send there (Hundres never auto-sends).'
              : 'Email copy is prepared for you to paste — connect Mailchimp to create draft campaigns automatically.'
            : action.channel === 'instagram' || isInstagramReelOrVideo(action)
              ? integrations.runwayReady
                ? 'The agent generates AI video (Runway) and publishes when Instagram auto-publish is on.'
                : 'The agent creates and publishes Instagram content — add RUNWAY_API_KEY for AI video Reels.'
              : 'The agent generates and publishes content automatically when integrations are connected.';

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
    const live = isShopifyAutoPublishLiveEnabled();
    return {
      mode: 'automated_write',
      executionType: 'create_shopify_page',
      platform: 'shopify',
      riskLevel: 'low',
      summary: integrations.shopifyContentWrite
        ? `Create Shopify page (${live ? 'live' : 'draft'}) for "${action.title}".`
        : `Preview Shopify page for "${action.title}" (write_content scope pending).`,
    };
  }

  if (intent === 'shopify_blog') {
    if (
      isSingleShopifyBlogPost(action) &&
      integrations.shopify &&
      integrations.shopifyContentWrite
    ) {
      const live = isShopifyAutoPublishLiveEnabled();
      return {
        mode: 'automated_write',
        executionType: 'create_shopify_blog_article',
        platform: 'shopify',
        riskLevel: 'low',
        summary: `Publish Shopify blog article (${live ? 'live' : 'draft'}) for "${action.title}".`,
      };
    }
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

  if (intent === 'instagram_story') {
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady) {
      return {
        mode: 'automated_write',
        executionType: 'publish_instagram_story',
        platform: 'instagram',
        riskLevel: 'low',
        summary: `Publish Instagram story for "${action.title}".`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: integrations.instagram ? 'instagram' : 'hundres',
      riskLevel: 'low',
      summary: `Generate Instagram story image for "${action.title}"${integrations.instagram ? '' : ' — connect Instagram to auto-publish'}.`,
    };
  }

  if (intent === 'instagram_reel') {
    if (
      isInstagramAutoPublishEnabled() &&
      integrations.instagramReady &&
      (integrations.runwayReady || /https?:\/\//.test(actionBlob(action)))
    ) {
      return {
        mode: 'automated_write',
        executionType: 'publish_instagram_reel',
        platform: 'instagram',
        riskLevel: 'low',
        summary: `Generate Runway AI video and publish Instagram Reel for "${action.title}".`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: integrations.instagram ? 'instagram' : 'hundres',
      riskLevel: 'low',
      summary: integrations.runwayReady
        ? `Prepare Instagram Reel brief for "${action.title}" — connect Instagram to publish.`
        : `Prepare Instagram Reel for "${action.title}" — add RUNWAY_API_KEY and Instagram so the agent can generate and publish.`,
    };
  }

  if (intent === 'instagram_publish') {
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady) {
      return {
        mode: 'automated_write',
        executionType: 'publish_instagram_photo',
        platform: 'instagram',
        riskLevel: 'low',
        summary: `Publish Instagram photo for "${action.title}".`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: integrations.instagram ? 'instagram' : 'hundres',
      riskLevel: 'low',
      summary: `Generate Instagram deliverable for "${action.title}"${integrations.instagram ? '' : ' — connect Instagram to auto-publish'}.`,
    };
  }

  if (intent === 'assist' && isAdvertPlanAssist(action)) {
    if (integrations.metaAdsReady) {
      return {
        mode: 'automated_write',
        executionType: 'create_meta_ads_campaign',
        platform: 'meta_ads',
        riskLevel: 'medium',
        summary: `Create paused Meta campaign for "${action.title}".`,
      };
    }
    if (isGoogleAdsEnabled() && integrations.googleAdsReady) {
      return {
        mode: 'automated_write',
        executionType: 'create_google_ads_campaign',
        platform: 'google_ads',
        riskLevel: 'medium',
        summary: `Create paused Google Search campaign for "${action.title}".`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: 'hundres',
      riskLevel: 'medium',
      summary: `Build advert plan for "${action.title}" — connect Meta Ads to create campaigns automatically.`,
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
    if (isGoogleAdsEnabled() && integrations.googleAdsReady) {
      return {
        mode: 'automated_write',
        executionType: 'create_google_ads_campaign',
        platform: 'google_ads',
        riskLevel: 'medium',
        summary: `Create paused Google Search campaign for "${action.title}".`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: 'hundres',
      riskLevel: 'medium',
      summary: isGoogleAdsEnabled()
        ? `Prepare Google Ads setup guide and ad copy for "${action.title}" (connect Google Ads to create campaigns).`
        : `Paid search brief for "${action.title}" — Google Ads is disabled; use Meta Ads or paste into Ads Manager manually.`,
    };
  }

  if (intent === 'mailchimp_campaign') {
    if (integrations.mailchimpReady) {
      return {
        mode: 'automated_write',
        executionType: 'create_mailchimp_drafts',
        platform: 'mailchimp',
        riskLevel: 'low',
        summary: `Create Mailchimp draft campaign(s) for "${action.title}" — you send from Mailchimp.`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: 'hundres',
      riskLevel: 'low',
      summary: `Draft email copy for "${action.title}" — connect Mailchimp to create campaigns as drafts.`,
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

/** Ad-hoc chat tasks: one blog post request always maps to a single article write, not a calendar.
 *  Agent briefs can force Reel/Story even when the action title is vague. */
export function resolveAdHocActionRoute(
  action: PlanAction,
  integrations: OrgIntegrationFlags,
  brief?: {
    mediaFormat?: string;
    videoSource?: string;
    videoUrl?: string;
    recipeSlug?: string;
    fullRequest?: string;
  } | null
): ExecutionRoute {
  const intent = classifyActionIntent(action);

  if (intent === 'shopify_blog') {
    if (integrations.shopify && integrations.shopifyContentWrite) {
      const live = isShopifyAutoPublishLiveEnabled();
      return {
        mode: 'automated_write',
        executionType: 'create_shopify_blog_article',
        platform: 'shopify',
        riskLevel: 'low',
        summary: `Publish Shopify blog article (${live ? 'live' : 'draft'}) for "${action.title}".`,
      };
    }
    return {
      mode: 'assist',
      executionType: 'assist_deliverable',
      platform: integrations.shopify ? 'shopify' : 'hundres',
      riskLevel: 'low',
      summary: integrations.shopify
        ? `Draft Shopify blog article for "${action.title}" — grant write_content to publish live.`
        : `Generate blog draft for "${action.title}" — connect Shopify to publish.`,
    };
  }

  const blob = `${brief?.fullRequest ?? ''} ${action.title}`.toLowerCase();
  const wantsStill =
    brief?.mediaFormat === 'feed' ||
    brief?.mediaFormat === 'carousel' ||
    brief?.recipeSlug === 'runway-text-to-image' ||
    brief?.recipeSlug === 'runway-product-campaign-image' ||
    brief?.recipeSlug?.includes('text-to-image') ||
    /text.to.image|text_to_image|feed photo|ai (image|photo|still)/.test(blob);

  const wantsReel =
    !wantsStill &&
    (brief?.mediaFormat === 'reel' ||
      brief?.videoSource === 'runway' ||
      brief?.recipeSlug?.includes('ugc') ||
      brief?.recipeSlug?.includes('product-ad') ||
      brief?.recipeSlug?.includes('text-to-video') ||
      /\bugc\b|user.?generated/.test(blob) ||
      Boolean(brief?.videoUrl?.startsWith('https://')) ||
      intent === 'instagram_reel');

  if (wantsReel && brief?.mediaFormat !== 'story') {
    if (
      isInstagramAutoPublishEnabled() &&
      integrations.instagramReady &&
      (integrations.runwayReady || brief?.videoUrl?.startsWith('https://'))
    ) {
      return {
        mode: 'automated_write',
        executionType: 'publish_instagram_reel',
        platform: 'instagram',
        riskLevel: 'low',
        summary: `Generate Runway AI video and publish Instagram Reel for "${action.title}".`,
      };
    }
  }

  if (brief?.mediaFormat === 'story') {
    if (isInstagramAutoPublishEnabled() && integrations.instagramReady) {
      return {
        mode: 'automated_write',
        executionType: 'publish_instagram_story',
        platform: 'instagram',
        riskLevel: 'low',
        summary: `Publish Instagram story for "${action.title}".`,
      };
    }
  }

  return resolveActionRoute(action, integrations);
}

export function isAutomatedWrite(route: ExecutionRoute): boolean {
  return (
    route.mode === 'automated_write' &&
    (route.executionType === 'update_product_seo' ||
      route.executionType === 'create_shopify_page' ||
      route.executionType === 'create_shopify_blog_article' ||
      route.executionType === 'publish_instagram_photo' ||
      route.executionType === 'publish_instagram_story' ||
      route.executionType === 'publish_instagram_reel' ||
      route.executionType === 'create_google_ads_campaign' ||
      route.executionType === 'create_meta_ads_campaign')
  );
}
