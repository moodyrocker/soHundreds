import { z } from 'zod';
import type { MailchimpSequenceState } from '../types/execution.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';

const emailSchema = z.object({
  dayOffset: z.preprocess((v) => Number(v), z.number().int().min(0).max(90)).default(0),
  subject: z.string().min(1).max(150),
  previewText: z.string().max(150).optional(),
  bodyPlain: z.string().min(1),
  title: z.string().max(100).optional(),
});

const sequenceSchema = z.object({
  sequenceName: z.string().min(1).max(100),
  audienceName: z.string().min(1).max(100).optional(),
  fromName: z.string().min(1).max(100),
  replyTo: z.string().email(),
  emails: z.array(emailSchema).min(1).max(5),
  reasoning: z.string().optional(),
});

export function parseMailchimpSequenceJson(text: string): MailchimpSequenceState {
  const raw = extractJsonFromModelText(text);
  const parsed = sequenceSchema.parse(raw);
  const clean = sanitizeModelStrings(parsed) as z.infer<typeof sequenceSchema>;

  return {
    kind: 'mailchimp_sequence',
    sequenceName: clean.sequenceName.trim(),
    audienceName: clean.audienceName?.trim(),
    fromName: clean.fromName.trim(),
    replyTo: clean.replyTo.trim(),
    emails: clean.emails.map((e, i) => ({
      dayOffset: e.dayOffset ?? i * 3,
      subject: e.subject.trim(),
      previewText: e.previewText?.trim(),
      bodyPlain: e.bodyPlain.trim(),
      title: (e.title ?? `Day ${e.dayOffset ?? i * 3}: ${e.subject}`).trim().slice(0, 100),
    })),
    reasoning: clean.reasoning,
    status: 'draft_proposal',
  };
}
