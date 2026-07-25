/**
 * Mailchimp Marketing API v3 client (per-org API key).
 * Key format: `{key}-{dc}` e.g. `abc123-us21`
 */

export type MailchimpContext = {
  apiKey: string;
  datacenter: string;
  defaultListId?: string | null;
  accountName?: string | null;
};

export type MailchimpList = {
  id: string;
  name: string;
  memberCount: number;
};

export type MailchimpCampaignDraft = {
  id: string;
  webId: number;
  status: string;
  archiveUrl?: string;
};

function parseDatacenter(apiKey: string): string {
  const parts = apiKey.trim().split('-');
  const dc = parts[parts.length - 1];
  if (!dc || parts.length < 2) {
    throw new Error(
      'Mailchimp API key must include datacenter suffix (e.g. xxxxx-us21). Find it in Mailchimp → Account → Extras → API keys.'
    );
  }
  return dc;
}

export function parseMailchimpApiKey(apiKey: string): { apiKey: string; datacenter: string } {
  const key = apiKey.trim();
  if (!key) throw new Error('Mailchimp API key is required');
  return { apiKey: key, datacenter: parseDatacenter(key) };
}

function baseUrl(dc: string): string {
  return `https://${dc}.api.mailchimp.com/3.0`;
}

async function mailchimpFetch<T>(
  ctx: MailchimpContext,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${baseUrl(ctx.datacenter)}${path}`;
  const auth = Buffer.from(`anystring:${ctx.apiKey}`).toString('base64');
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    let detail = errText.slice(0, 400);
    try {
      const parsed = JSON.parse(errText) as { detail?: string; title?: string };
      detail = parsed.detail || parsed.title || detail;
    } catch {
      /* keep raw */
    }
    throw new Error(`Mailchimp API ${response.status}: ${detail}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

export async function mailchimpPing(ctx: MailchimpContext): Promise<{
  accountName: string;
  email: string;
}> {
  const data = await mailchimpFetch<{ account_name?: string; email?: string }>(ctx, '/');
  return {
    accountName: data.account_name ?? 'Mailchimp',
    email: data.email ?? '',
  };
}

export async function mailchimpListAudiences(ctx: MailchimpContext): Promise<MailchimpList[]> {
  const data = await mailchimpFetch<{
    lists?: Array<{ id: string; name: string; stats?: { member_count?: number } }>;
  }>(ctx, '/lists?count=50&fields=lists.id,lists.name,lists.stats.member_count');
  return (data.lists ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    memberCount: l.stats?.member_count ?? 0,
  }));
}

export async function mailchimpCreateAudience(
  ctx: MailchimpContext,
  input: { name: string; fromEmail: string; fromName: string; subject?: string }
): Promise<MailchimpList> {
  const data = await mailchimpFetch<{
    id: string;
    name: string;
    stats?: { member_count?: number };
  }>(ctx, '/lists', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name.slice(0, 100),
      contact: {
        company: input.fromName.slice(0, 100) || 'Business',
        address1: 'Address pending',
        city: 'City',
        state: 'State',
        zip: '00000',
        country: 'US',
      },
      permission_reminder: 'You are receiving this email because you opted in on our website.',
      campaign_defaults: {
        from_name: input.fromName.slice(0, 100) || 'Team',
        from_email: input.fromEmail,
        subject: input.subject?.slice(0, 150) || input.name.slice(0, 150),
        language: 'en',
      },
      email_type_option: false,
    }),
  });
  return {
    id: data.id,
    name: data.name,
    memberCount: data.stats?.member_count ?? 0,
  };
}

export async function mailchimpUpsertMember(
  ctx: MailchimpContext,
  listId: string,
  input: { email: string; status?: 'subscribed' | 'pending' | 'unsubscribed'; tags?: string[] }
): Promise<{ id: string; email: string; status: string }> {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('md5').update(input.email.trim().toLowerCase()).digest('hex');
  const data = await mailchimpFetch<{ id: string; email_address: string; status: string }>(
    ctx,
    `/lists/${listId}/members/${hash}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        email_address: input.email.trim(),
        status_if_new: input.status ?? 'subscribed',
        status: input.status ?? 'subscribed',
        tags: input.tags ?? [],
      }),
    }
  );
  return { id: data.id, email: data.email_address, status: data.status };
}

export async function mailchimpCreateCampaignDraft(
  ctx: MailchimpContext,
  input: {
    listId: string;
    subject: string;
    fromName: string;
    replyTo: string;
    title?: string;
  }
): Promise<MailchimpCampaignDraft> {
  const data = await mailchimpFetch<{
    id: string;
    web_id: number;
    status: string;
    archive_url?: string;
  }>(ctx, '/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      type: 'regular',
      recipients: { list_id: input.listId },
      settings: {
        subject_line: input.subject.slice(0, 150),
        title: (input.title || input.subject).slice(0, 100),
        from_name: input.fromName.slice(0, 100),
        reply_to: input.replyTo,
        auto_footer: true,
      },
    }),
  });
  return {
    id: data.id,
    webId: data.web_id,
    status: data.status,
    archiveUrl: data.archive_url,
  };
}

export async function mailchimpSetCampaignContent(
  ctx: MailchimpContext,
  campaignId: string,
  html: string
): Promise<void> {
  await mailchimpFetch(ctx, `/campaigns/${campaignId}/content`, {
    method: 'PUT',
    body: JSON.stringify({
      html: html.slice(0, 500_000),
    }),
  });
}

/** Never call from autopilot without an explicit human gate. */
export async function mailchimpSendCampaign(
  ctx: MailchimpContext,
  campaignId: string
): Promise<void> {
  await mailchimpFetch(ctx, `/campaigns/${campaignId}/actions/send`, {
    method: 'POST',
  });
}

export function plainTextToEmailHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.5;color:#111">${escaped}</body></html>`;
}
