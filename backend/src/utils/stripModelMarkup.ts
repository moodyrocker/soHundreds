/**
 * Anthropic web_search can leak citation markup into JSON string fields, e.g.
 * `<cite index="1-1">`. Strip before persisting or displaying plan copy.
 */
export function stripWebSearchCitations(text: string): string {
  return text
    .replace(/<cite[^>]*>([\s\S]*?)<\/cite>/gi, '$1')
    .replace(/<cite[^>]*\/?>/gi, '')
    .replace(/<\/cite>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function sanitizeModelStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return stripWebSearchCitations(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeModelStrings(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeModelStrings(nested);
    }
    return out as T;
  }
  return value;
}
