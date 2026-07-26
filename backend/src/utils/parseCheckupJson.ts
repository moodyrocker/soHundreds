import { checkupDocumentSchema, type CheckupDocument } from '../types/checkup.js';
import { extractJsonFromModelText } from './parsePlanJson.js';
import { sanitizeModelStrings } from './stripModelMarkup.js';

export function parseCheckupJson(text: string): CheckupDocument {
  const raw = extractJsonFromModelText(text);
  return sanitizeModelStrings(checkupDocumentSchema.parse(raw));
}
