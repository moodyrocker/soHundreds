import {
  mailchimpCreateAudience,
  mailchimpCreateCampaignDraft,
  mailchimpListAudiences,
  mailchimpSetCampaignContent,
  plainTextToEmailHtml,
  type MailchimpContext,
} from '../lib/mailchimpClient.js';
import type { MailchimpSequenceState } from '../types/execution.js';

async function ensureAudience(
  ctx: MailchimpContext,
  input: { name: string; fromEmail: string; fromName: string }
): Promise<{ id: string; name: string }> {
  const existing = await mailchimpListAudiences(ctx);
  const hit = existing.find((l) => l.name.toLowerCase() === input.name.trim().toLowerCase());
  if (hit) return { id: hit.id, name: hit.name };
  const created = await mailchimpCreateAudience(ctx, input);
  return { id: created.id, name: created.name };
}

/**
 * Creates Mailchimp DRAFT campaigns for each email in the sequence.
 * Never sends — user reviews and sends in Mailchimp (human gate).
 */
export class MailchimpExecutionService {
  async createDraftSequence(
    ctx: MailchimpContext,
    proposed: MailchimpSequenceState
  ): Promise<MailchimpSequenceState> {
    let listId = ctx.defaultListId ?? null;
    let listName: string | null = null;

    if (!listId && proposed.audienceName) {
      const audience = await ensureAudience(ctx, {
        name: proposed.audienceName,
        fromEmail: proposed.replyTo,
        fromName: proposed.fromName,
      });
      listId = audience.id;
      listName = audience.name;
    }

    if (!listId) {
      throw new Error(
        'No Mailchimp audience selected. Connect Mailchimp and choose a default list in Integrations, or include an audienceName in the sequence.'
      );
    }

    const created: NonNullable<MailchimpSequenceState['createdCampaigns']> = [];

    for (const email of proposed.emails) {
      const draft = await mailchimpCreateCampaignDraft(ctx, {
        listId,
        subject: email.subject,
        fromName: proposed.fromName,
        replyTo: proposed.replyTo,
        title: email.title || `${proposed.sequenceName} — Day ${email.dayOffset}`,
      });
      await mailchimpSetCampaignContent(ctx, draft.id, plainTextToEmailHtml(email.bodyPlain));
      created.push({
        campaignId: draft.id,
        webId: draft.webId,
        subject: email.subject,
        dayOffset: email.dayOffset,
        archiveUrl: draft.archiveUrl,
      });
    }

    return {
      ...proposed,
      listId,
      listName: listName ?? proposed.audienceName ?? null,
      createdCampaigns: created,
      status: 'drafts_created',
    };
  }
}
