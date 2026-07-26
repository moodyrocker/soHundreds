import {
  mailchimpCreateAudience,
  mailchimpCreateCampaignDraft,
  mailchimpListAudiences,
  mailchimpPing,
  mailchimpSetCampaignContent,
  mailchimpUpsertMember,
  plainTextToEmailHtml,
  type MailchimpContext,
} from '../lib/mailchimpClient.js';

export async function mcpMailchimpHealth(ctx: MailchimpContext): Promise<string> {
  const ping = await mailchimpPing(ctx);
  const lists = await mailchimpListAudiences(ctx);
  return JSON.stringify(
    {
      ok: true,
      accountName: ping.accountName,
      email: ping.email,
      audienceCount: lists.length,
      defaultListId: ctx.defaultListId ?? null,
      audiences: lists.slice(0, 10),
    },
    null,
    2
  );
}

export async function mcpMailchimpListAudiences(ctx: MailchimpContext): Promise<string> {
  const lists = await mailchimpListAudiences(ctx);
  return JSON.stringify({ audiences: lists }, null, 2);
}

export async function mcpMailchimpEnsureAudience(
  ctx: MailchimpContext,
  input: { name: string; fromEmail: string; fromName: string }
): Promise<string> {
  const existing = await mailchimpListAudiences(ctx);
  const hit = existing.find(
    (l) => l.name.toLowerCase() === input.name.trim().toLowerCase()
  );
  if (hit) {
    return JSON.stringify({ audience: hit, created: false }, null, 2);
  }
  const created = await mailchimpCreateAudience(ctx, input);
  return JSON.stringify({ audience: created, created: true }, null, 2);
}

export async function mcpMailchimpUpsertMember(
  ctx: MailchimpContext,
  input: { listId?: string; email: string; tags?: string[] }
): Promise<string> {
  const listId = input.listId || ctx.defaultListId;
  if (!listId) {
    throw new Error('listId required (or set a default audience in Integrations)');
  }
  const member = await mailchimpUpsertMember(ctx, listId, {
    email: input.email,
    tags: input.tags,
  });
  return JSON.stringify({ member, listId }, null, 2);
}

export async function mcpMailchimpCreateDraftCampaign(
  ctx: MailchimpContext,
  input: {
    listId?: string;
    subject: string;
    bodyPlain: string;
    fromName: string;
    replyTo: string;
    title?: string;
  }
): Promise<string> {
  const listId = input.listId || ctx.defaultListId;
  if (!listId) {
    throw new Error('listId required (or set a default audience in Integrations)');
  }
  const draft = await mailchimpCreateCampaignDraft(ctx, {
    listId,
    subject: input.subject,
    fromName: input.fromName,
    replyTo: input.replyTo,
    title: input.title,
  });
  await mailchimpSetCampaignContent(ctx, draft.id, plainTextToEmailHtml(input.bodyPlain));
  return JSON.stringify(
    {
      campaign: draft,
      listId,
      sendNote:
        'Draft only — Hundres never auto-sends. Review and send in Mailchimp, or use a human-gated send action.',
      editUrl: `https://${ctx.datacenter}.admin.mailchimp.com/campaigns/show/?id=${draft.webId}`,
    },
    null,
    2
  );
}
