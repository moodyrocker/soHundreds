'use client';

export type WhatToDoInput = {
  title: string;
  channel: string;
  outcome?: string;
  kpi?: string;
  executionType?: string;
  executionStatus?: string;
  targetLabel?: string | null;
  hasMcpPrompt?: boolean;
  pageHandle?: string;
  error?: string | null;
  /** True once an execution record exists. When false, show "run autopilot first" steps. */
  executionExists?: boolean;
  /** Instagram assist preview — when set, user should review suggested image. */
  proposedImageUrl?: string;
};

function slug(text: string): string {
  return text.toLowerCase();
}

/** Generate specific, actionable steps based on what we know about the action. */
export function buildExplicitWhatToDoSteps(input: WhatToDoInput): string[] {
  const steps: string[] = [];
  const t = slug(input.title);
  const o = slug(input.outcome ?? '');
  const ch = input.channel;

  if (input.error) {
    steps.push('Read the error message shown — fix the blocker (e.g. reconnect the integration in Settings → Integrations).');
    steps.push('Click "Check data & run autopilot" again to regenerate this action once fixed.');
    return steps;
  }

  // ── Write in flight ───────────────────────────────────────────────────────
  // 'executing' means one caller holds the execution claim and is mid-write to
  // the external platform. Manual instructions here would invite the user to
  // duplicate the very write we just made single-owner, so short-circuit.
  if (input.executionStatus === 'executing') {
    steps.push('Hundres is applying this change on the platform right now — no action needed.');
    steps.push('This panel will update on its own once the write completes.');
    steps.push('If it is still showing this after a few minutes, check the Activity log for a Failed row.');
    return steps;
  }

  // ── Not yet generated ─────────────────────────────────────────────────────
  // Show pre-generation steps when autopilot hasn't run for this action yet.
  if (!input.executionExists && !input.executionType) {
    steps.push('Click "Check data & run autopilot" — Hundres will generate the deliverable copy for this action.');
    steps.push('Come back to this panel once it finishes — the headline, copy, and apply instructions will appear below the reasoning.');
    if (input.outcome) steps.push(`Goal for this action: ${input.outcome}`);
    if (input.kpi) steps.push(`You will track: ${input.kpi}`);
    return steps;
  }

  // ── Shopify page write ────────────────────────────────────────────────────
  if (input.executionType === 'create_shopify_page') {
    if (input.hasMcpPrompt) {
      steps.push('Scroll down to the "Claude.ai + Shopify MCP prompt" block and click Copy MCP prompt.');
      steps.push('Open Claude.ai (desktop or claude.ai) with the Shopify MCP connected to your store.');
      steps.push('Paste the prompt and run it — Claude will create the page as a Shopify draft.');
      steps.push('In Shopify Admin → Online Store → Pages, find the new draft and preview it.');
      steps.push('When satisfied, click Publish in Shopify, then mark this action Done here.');
    } else if (input.executionStatus === 'previewed') {
      steps.push('Review the proposed page title, URL handle, and body copy in the panel below.');
      steps.push('To publish: once write_content is granted in Shopify Partners, click Approve in Hundres for auto-publish.');
      steps.push('Alternatively, copy the content below and create the page manually in Shopify Admin → Online Store → Pages → Add page.');
    } else {
      steps.push(`Open Shopify Admin → Online Store → Pages and find "/pages/${input.pageHandle ?? 'your-page'}".`);
      steps.push('Read through the page content — make any brand-voice edits you need.');
      steps.push('Click Save, preview on your storefront, then click Publish when satisfied.');
      steps.push('Mark this action Done in Autopilot.');
    }
    return steps;
  }

  // ── Product SEO write ─────────────────────────────────────────────────────
  if (input.executionType === 'update_product_seo') {
    const product = input.targetLabel ?? 'the product';
    if (input.executionStatus === 'previewed') {
      steps.push(`Open Shopify Admin → Products → search for "${product}" → click Edit.`);
      steps.push('Scroll to "Search engine listing" at the bottom of the product page.');
      steps.push('Copy the proposed SEO title from the deliverable panel below → paste it into the Page title field.');
      steps.push('Copy the proposed meta description → paste it into the Meta description field.');
      steps.push('Click Save product. Or, once write_products scope is granted, click Approve here to auto-apply.');
    } else {
      steps.push(`Open Shopify Admin → Products → "${product}" and confirm the SEO title and meta description match the proposed values shown below.`);
      steps.push('If they differ, update them manually in the Search engine listing section and save.');
    }
    steps.push('Mark this action Done in Autopilot once the listing is updated.');
    return steps;
  }

  // ── From here: assist deliverables. Detect sub-type from title + channel. ──

  // Homepage / website copy
  if (/homepage|home page|hero|value prop|tagline|headline|landing|cta|messaging|above the fold/.test(t) ||
      /homepage|hero|value prop|tagline|headline/.test(o)) {
    steps.push('Read the full deliverable below — headline, value props, and CTA copy are in the main copy block.');
    steps.push('Open Shopify Admin → Online Store → Themes → click Customize on your active theme.');
    steps.push('Navigate to the Homepage section in the theme editor (usually "Header" or "Hero").');
    steps.push('Copy your new headline from the deliverable → paste it into the hero title field in the theme editor.');
    steps.push('Copy each value prop bullet → paste them into the theme\'s features/benefits section or blocks.');
    steps.push('Update the primary CTA button text to match the deliverable\'s CTA wording.');
    steps.push('Click Save in the theme editor, then preview on desktop and mobile to confirm it looks right.');
    if (input.kpi) steps.push(`Check ${input.kpi} in Google Analytics after 48 hours — paste your GA4 property URL in a browser bookmark for easy access.`);
    steps.push('Mark this action Done in Autopilot once the homepage is live with the new copy.');
    return steps;
  }

  // GA4 / analytics / tracking setup
  if (/google analytics|ga4|ga 4|event tracking|analytics setup|tag manager|gtm|conversion tracking|tracking code|search console|pixel/.test(t)) {
    steps.push('Read all the steps in the deliverable carefully before starting — they are ordered.');
    steps.push('Open analytics.google.com (or tagmanager.google.com for GTM) in a new tab.');
    steps.push('Follow each numbered step in the deliverable exactly — stop at each one and confirm it before moving to the next.');
    steps.push('To verify: go to GA4 → Reports → Realtime, open your website in another tab, and confirm you see live sessions appear.');
    steps.push('If an event isn\'t firing, check GA4 → DebugView for error details.');
    if (input.kpi) steps.push(`Goal: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once you can confirm data is appearing in GA4.');
    return steps;
  }

  // Instagram / social post
  if (ch === 'instagram' || /instagram|reel|story|social post|post caption/.test(t)) {
    steps.push('Read the caption and hashtags in the deliverable below.');
    if (input.proposedImageUrl) {
      steps.push('Review the proposed image in the deliverable — save it or swap for your own product photo if it is not on-brand.');
    }
    steps.push('Open Instagram on your phone (or Meta Business Suite on desktop).');
    steps.push(
      input.proposedImageUrl
        ? 'Tap the + icon → attach the proposed image (or your own product photo) → paste the caption.'
        : 'Tap the + icon → choose a relevant product photo or video from your library.'
    );
    steps.push('Paste the caption from the deliverable — edit the first line (hook) if needed to match the image.');
    steps.push('Add hashtags from the extras section. Delete any that don\'t fit your brand.');
    steps.push('Set your location tag and any product tags if relevant, then post (or schedule for your peak time).');
    if (input.kpi) steps.push(`Watch for: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once the post is live.');
    return steps;
  }

  // Email campaign
  if (ch === 'email' || /email|newsletter|campaign|klaviyo|mailchimp|subject line/.test(t)) {
    steps.push('Read the subject line (in extras) and email body in the deliverable.');
    steps.push('Open your email platform (Klaviyo, Mailchimp, Shopify Email, etc.).');
    steps.push('Create a new campaign → paste the subject line from extras → paste the body into the email editor.');
    steps.push('Add your logo, any product images, and adjust brand colours to match your theme.');
    steps.push('Send a test email to yourself and check it on mobile.');
    steps.push('Schedule or send to your full list when you\'re happy with it.');
    if (input.kpi) steps.push(`Track: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once the email is sent.');
    return steps;
  }

  // Paid ads — advert plan
  if (ch === 'paid' || /meta ads|google ads|ad copy|ad campaign|facebook ads|paid social|paid search/.test(t)) {
    steps.push('Open the advert plan below — budget, audience, and ad copy are all structured for you.');
    steps.push('Check platform (Meta or Google) and daily/total budget match what you want to spend.');
    steps.push('Open Meta Ads Manager or Google Ads and create a new campaign using the plan fields.');
    steps.push('Copy ad primary text and headline from the plan into your ad creative fields.');
    steps.push('Set targeting and budget exactly as listed — save as draft first.');
    steps.push('Preview on mobile and desktop, then publish when ready. Hundres never spends automatically.');
    if (input.kpi) steps.push(`Watch for: ${input.kpi}`);
    steps.push('Mark this action Done once the campaign is live.');
    return steps;
  }

  // Local / Google Business Profile
  if (ch === 'local' || /google business|gbp|local listing|google maps|local seo/.test(t)) {
    steps.push('Read the post copy in the deliverable below.');
    steps.push('Open business.google.com and sign in with the account that manages your listing.');
    steps.push('Click "Add update" → select the relevant post type (offer, event, or update).');
    steps.push('Paste the copy from the deliverable into the post body. Add a photo if available.');
    steps.push('Set any offer details or event dates from the extras section, then click Publish.');
    if (input.kpi) steps.push(`Track: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once the post is live.');
    return steps;
  }

  // SEO / keyword / content research
  if (/keyword|seo audit|search|rank|ranking|backlink|link building|meta|description|title tag/.test(t)) {
    steps.push('Read the full deliverable — keyword targets and recommendations are listed in priority order.');
    steps.push('Open Google Search Console (search.google.com/search-console) for your site.');
    steps.push('For each keyword recommendation: check current ranking in Search Console → Performance → Queries.');
    steps.push('Apply title tag and meta description changes in Shopify Admin → Online Store → Preferences (for the homepage) or the relevant product/page.');
    steps.push('Submit updated URLs for re-indexing in Search Console → URL Inspection → Request indexing.');
    if (input.kpi) steps.push(`Track: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once changes are saved.');
    return steps;
  }

  // Blog / content writing
  if (/blog|article|content|write|publish|post/.test(t) && (ch === 'content' || ch === 'seo')) {
    steps.push('Read the full content draft in the deliverable — intro, headings, and body are all there.');
    steps.push('Open Shopify Admin → Online Store → Blog posts → Add blog post.');
    steps.push('Paste the title and body copy from the deliverable into the blog post editor.');
    steps.push('Add a featured image (your product or a relevant lifestyle shot).');
    steps.push('Fill in the SEO title and meta description from the extras section if provided.');
    steps.push('Click Save as draft, preview it, then click Publish when ready.');
    if (input.kpi) steps.push(`Track: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once the post is live.');
    return steps;
  }

  // Generic content/SEO fallback (still specific enough to be useful)
  if (ch === 'seo' || ch === 'content') {
    steps.push('Read the full deliverable below — the headline and copy block tell you exactly what to write or change.');
    steps.push('Identify which platform the deliverable targets (check the paste instructions below the copy).');
    steps.push('Open that platform and navigate to the page, product, or section mentioned.');
    steps.push('Copy the relevant text from the deliverable and paste it into the correct field.');
    steps.push('Save / publish the change, then preview it to confirm it looks right.');
    if (input.kpi) steps.push(`Track: ${input.kpi}`);
    steps.push('Mark this action Done in Autopilot once live.');
    return steps;
  }

  // Generic catch-all — still useful, not just "run autopilot"
  steps.push('Read the full deliverable below — the headline and main copy are ready to use.');
  if (input.outcome) steps.push(`Goal: ${input.outcome}`);
  steps.push('Open the relevant platform (check paste instructions at the bottom of the deliverable).');
  steps.push('Copy the deliverable text and paste it into the correct field or editor.');
  steps.push('Save and publish, then preview your changes.');
  if (input.kpi) steps.push(`Track: ${input.kpi}`);
  steps.push('Mark this action Done in Autopilot once live.');
  return steps;
}

type Props = {
  aiSteps?: string[];
  explicitSteps: string[];
  pasteInstructions?: string | null;
};

export function WhatToDoPanel({ aiSteps = [], explicitSteps, pasteInstructions }: Props) {
  const ai = aiSteps.filter((s) => s.trim());
  const explicit = explicitSteps.filter((s) => s.trim());

  if (ai.length === 0 && explicit.length === 0) return null;

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border-bright, var(--border))',
        background: 'rgba(255, 255, 255, 0.04)',
      }}
    >
      <div
        className="t-mono"
        style={{
          fontSize: 10,
          color: 'var(--text-mute)',
          marginBottom: 8,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        What to do
      </div>

      {explicit.length > 0 ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Exact steps</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.65 }}>
            {explicit.map((step, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {step}
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {ai.length > 0 ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, margin: explicit.length > 0 ? '14px 0 8px' : '0 0 8px' }}>
            Detailed steps from Hundres
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              lineHeight: 1.65,
            }}
          >
            {ai.map((step, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {step}
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {pasteInstructions?.trim() ? (
        <p className="auth-hint" style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5 }}>
          <strong>Where to apply: </strong>
          {pasteInstructions}
        </p>
      ) : null}
    </div>
  );
}
