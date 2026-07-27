import { asMailchimpSequence } from './payloads.js';
import { PreflightRefusal } from './types.js';
import type { ApplyContext, ApplyResult, PlatformExecutor } from './types.js';

/**
 * Creates Mailchimp draft campaigns.
 *
 * The safest of the seven, and extracted first for that reason: it only ever
 * creates drafts. Hundres never sends, which is why both summary variants say so
 * explicitly — that reassurance is the whole reason a user is willing to connect
 * an email list.
 */
export const mailchimpExecutor: PlatformExecutor = {
  executionType: 'create_mailchimp_drafts',
  label: 'Mailchimp draft sequence',

  async apply({ organizationId, row, deps }: ApplyContext): Promise<ApplyResult> {
    const proposed = asMailchimpSequence(row.proposed_state);

    // Pre-flight, before any external call, so a refusal leaves the execution
    // retryable rather than failed.
    const ctx = await deps.mcp.getMailchimpContext(organizationId);
    if (!ctx?.defaultListId) {
      throw new PreflightRefusal(
        'Mailchimp is not connected or no default audience is selected'
      );
    }

    const after = await deps.mailchimpExecution.createDraftSequence(ctx, proposed);

    const count = after.createdCampaigns?.length ?? after.emails.length;
    const archiveUrl = after.createdCampaigns?.find((c) => c.archiveUrl?.startsWith('http'))
      ?.archiveUrl;

    return {
      after,
      summary: archiveUrl
        ? `Created ${count} Mailchimp draft(s) for "${after.sequenceName}" — open: ${archiveUrl} (you send from Mailchimp; never auto-sent).`
        : `Created ${count} Mailchimp draft campaign(s) for "${after.sequenceName}" — review and send in Mailchimp (Hundres never auto-sends).`,
    };
  },
};
