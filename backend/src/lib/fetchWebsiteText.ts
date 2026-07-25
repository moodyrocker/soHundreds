/**
 * Fetch a public marketing site and extract plain text for LLM prompts.
 * Follows redirects (e.g. www → apex on Shopify).
 */
export async function fetchWebsiteText(
  rawUrl: string,
  options?: { maxChars?: number }
): Promise<{ finalUrl: string; title: string; text: string } | null> {
  const maxChars = options?.maxChars ?? 12_000;
  let url: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  try {
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'HundresBot/1.0 (+https://hundres.app; business-profile draft; mailto:support@hundres.app)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(contentType) && contentType) {
      // Some CDNs omit content-type; still try if body looks like HTML later
      if (!contentType.includes('text') && !contentType.includes('html')) return null;
    }
    const html = await res.text();
    const finalUrl = res.url || url.toString();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).trim() : '';
    const text = htmlToPlainText(html).slice(0, maxChars);
    if (text.length < 40 && !title) return null;
    return { finalUrl, title, text };
  } catch {
    return null;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Prefer meta description when present
  const metaDesc =
    s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    s.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ||
    '';

  s = s
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br|hr)[^>]*>/gi, '\n')
    .replace(/<(br|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (metaDesc.trim()) {
    s = `Meta description: ${decodeEntities(metaDesc).trim()}\n\n${s}`;
  }
  return s;
}
