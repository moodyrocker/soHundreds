import { afterEach, describe, expect, it } from 'vitest';
import { parseShopifyPageJson } from './parseShopifyPageJson.js';
import { parseGoogleAdsError } from './parseGoogleAdsError.js';
import { sanitizeModelStrings, stripWebSearchCitations } from './stripModelMarkup.js';

/**
 * The deliverable parsers turn model output into the exact payload that gets
 * written to a third-party platform. Unlike the plan parser, a mistake here is
 * visible to the customer's customers: a mangled page body on a live storefront,
 * or a handle that collides with an existing URL.
 */

const ENV_KEYS = ['SHOPIFY_AUTO_PUBLISH_LIVE'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

function pageJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'Our Story',
    handle: 'our-story',
    bodyHtml: '<p>We started in 2019.</p>',
    seoTitle: 'Our Story | Brand',
    seoDescription: 'How we began and what we believe.',
    ...overrides,
  });
}

describe('parseShopifyPageJson', () => {
  it('parses a well-formed page', () => {
    const page = parseShopifyPageJson(pageJson());
    expect(page.kind).toBe('shopify_page');
    expect(page.title).toBe('Our Story');
    expect(page.handle).toBe('our-story');
    expect(page.pageId).toBeNull();
  });

  it('normalises the handle: lowercased, surrounding slashes stripped', () => {
    // A handle becomes a live URL. A leading slash or stray case produces either
    // a 404 or a duplicate page depending on the platform.
    const page = parseShopifyPageJson(pageJson({ handle: '/Our-Story/' }));
    expect(page.handle).toBe('our-story');
  });

  it('strips multiple leading and trailing slashes', () => {
    expect(parseShopifyPageJson(pageJson({ handle: '///about///' })).handle).toBe('about');
  });

  it('builds bodyHtml from sections when bodyHtml is absent', () => {
    const page = parseShopifyPageJson(
      pageJson({
        bodyHtml: undefined,
        sections: [
          { heading: 'Beginnings', paragraphs: ['We started small.', 'Then we grew.'] },
          { paragraphs: ['No heading here.'] },
        ],
      })
    );
    expect(page.bodyHtml).toContain('<h2>Beginnings</h2>');
    expect(page.bodyHtml).toContain('<p>We started small.</p>');
    expect(page.bodyHtml).toContain('<p>Then we grew.</p>');
    // A section without a heading must not emit an empty <h2>.
    expect(page.bodyHtml).not.toContain('<h2></h2>');
  });

  it('escapes HTML in section content, so model output cannot inject markup', () => {
    // The model is not trusted to produce safe HTML. This content goes onto a
    // live storefront page.
    const page = parseShopifyPageJson(
      pageJson({
        bodyHtml: undefined,
        sections: [
          {
            heading: '<script>alert(1)</script>',
            paragraphs: ['5 > 3 & "quoted" <b>bold</b>'],
          },
        ],
      })
    );
    expect(page.bodyHtml).not.toContain('<script>');
    expect(page.bodyHtml).toContain('&lt;script&gt;');
    expect(page.bodyHtml).toContain('&amp;');
    expect(page.bodyHtml).toContain('&quot;');
    expect(page.bodyHtml).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('prefers bodyHtml over sections when both are present', () => {
    const page = parseShopifyPageJson(
      pageJson({
        bodyHtml: '<p>explicit</p>',
        sections: [{ paragraphs: ['from sections'] }],
      })
    );
    expect(page.bodyHtml).toBe('<p>explicit</p>');
  });

  it('falls back to sections when bodyHtml is only whitespace', () => {
    const page = parseShopifyPageJson(
      pageJson({ bodyHtml: '   ', sections: [{ paragraphs: ['real content'] }] })
    );
    expect(page.bodyHtml).toContain('real content');
  });

  it('rejects a page with neither bodyHtml nor sections', () => {
    // The refine() guard. Without it a page would publish with an empty body.
    expect(() => parseShopifyPageJson(pageJson({ bodyHtml: undefined }))).toThrow();
  });

  it('rejects a page missing its SEO fields', () => {
    expect(() => parseShopifyPageJson(pageJson({ seoTitle: undefined }))).toThrow();
    expect(() => parseShopifyPageJson(pageJson({ seoDescription: undefined }))).toThrow();
  });

  it('rejects an empty title or handle', () => {
    expect(() => parseShopifyPageJson(pageJson({ title: '' }))).toThrow();
    expect(() => parseShopifyPageJson(pageJson({ handle: '' }))).toThrow();
  });

  it('strips cite markup from copy that will be published', () => {
    const page = parseShopifyPageJson(
      pageJson({ title: 'Our <cite index="1">Story</cite>' })
    );
    expect(page.title).toBe('Our Story');
  });

  it('unwraps a fenced block, as the plan parser does', () => {
    const page = parseShopifyPageJson(`Here you go:\n\`\`\`json\n${pageJson()}\n\`\`\``);
    expect(page.title).toBe('Our Story');
  });

  describe('isPublished reflects the auto-publish feature flag', () => {
    it('is false when SHOPIFY_AUTO_PUBLISH_LIVE is unset — draft by default', () => {
      delete process.env.SHOPIFY_AUTO_PUBLISH_LIVE;
      expect(parseShopifyPageJson(pageJson()).isPublished).toBe(false);
    });

    it('is false when explicitly disabled', () => {
      process.env.SHOPIFY_AUTO_PUBLISH_LIVE = 'false';
      expect(parseShopifyPageJson(pageJson()).isPublished).toBe(false);
    });

    it('is true only when explicitly enabled', () => {
      process.env.SHOPIFY_AUTO_PUBLISH_LIVE = 'true';
      expect(parseShopifyPageJson(pageJson()).isPublished).toBe(true);
    });
  });
});

describe('parseGoogleAdsError', () => {
  it('extracts a nested errorCode and maps it to a user-facing message', () => {
    const body = JSON.stringify({
      error: {
        message: 'Request contains an invalid argument.',
        details: [
          {
            errors: [
              {
                message: 'The developer token is not approved.',
                errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' },
              },
            ],
          },
        ],
      },
    });
    const parsed = parseGoogleAdsError(body, 403);
    expect(parsed.code).toBe('DEVELOPER_TOKEN_NOT_APPROVED');
    expect(parsed.message).toBe('The developer token is not approved.');
    expect(parsed.userMessage).toMatch(/has not approved your developer token/);
  });

  it('maps each known code to its own guidance', () => {
    const codes = [
      'DEVELOPER_TOKEN_PROHIBITED',
      'CUSTOMER_NOT_ENABLED',
      'USER_PERMISSION_DENIED',
      'OAUTH_TOKEN_INVALID',
      'OAUTH_TOKEN_EXPIRED',
      'UNSUPPORTED_VERSION',
    ];
    const messages = codes.map((code) => {
      const body = JSON.stringify({
        error: { details: [{ errors: [{ errorCode: { x: code } }] }] },
      });
      return parseGoogleAdsError(body, 400).userMessage;
    });
    // Each code must produce distinct, actionable guidance rather than a shared
    // generic string.
    expect(new Set(messages).size).toBe(codes.length);
    expect(messages.every((m) => m.length > 20)).toBe(true);
  });

  it('detects DEVELOPER_TOKEN_NOT_APPROVED from a 403 body even without JSON structure', () => {
    const parsed = parseGoogleAdsError('DEVELOPER_TOKEN_NOT_APPROVED somewhere in here', 403);
    expect(parsed.code).toBe('DEVELOPER_TOKEN_NOT_APPROVED');
  });

  it('falls back to a status-specific message for 401', () => {
    const parsed = parseGoogleAdsError('not json at all', 401);
    expect(parsed.code).toBeNull();
    expect(parsed.userMessage).toMatch(/authorization failed/i);
  });

  it('falls back to a status-specific message for 403', () => {
    expect(parseGoogleAdsError('nope', 403).userMessage).toMatch(/denied access/i);
  });

  it('falls back to a generic message for any other status', () => {
    expect(parseGoogleAdsError('nope', 500).userMessage).toMatch(/could not be loaded/i);
  });

  it('never throws on unparseable input', () => {
    // This runs inside a catch block during a snapshot fetch. Throwing here would
    // replace a useful error with a confusing one.
    for (const body of ['', '{', 'null', '[]', '<html>502</html>', ' ']) {
      expect(() => parseGoogleAdsError(body)).not.toThrow();
      expect(typeof parseGoogleAdsError(body).userMessage).toBe('string');
    }
  });

  it('truncates a huge raw body to 400 characters', () => {
    // Prevents a multi-megabyte HTML error page reaching a log line or the UI.
    const parsed = parseGoogleAdsError('x'.repeat(5000), 500);
    expect(parsed.message.length).toBe(400);
  });

  it('prefers the specific nested error message over the outer one', () => {
    const body = JSON.stringify({
      error: {
        message: 'generic outer message',
        details: [{ errors: [{ message: 'specific inner message', errorCode: { a: 'X' } }] }],
      },
    });
    expect(parseGoogleAdsError(body).message).toBe('specific inner message');
  });
});

describe('stripWebSearchCitations', () => {
  it('unwraps a cite tag, keeping the text', () => {
    expect(stripWebSearchCitations('<cite index="1-1">ranked well</cite>')).toBe('ranked well');
  });

  it('removes a self-closing cite tag', () => {
    expect(stripWebSearchCitations('ranked well <cite index="2"/>')).toBe('ranked well');
  });

  it('removes a stray closing tag', () => {
    expect(stripWebSearchCitations('ranked well</cite>')).toBe('ranked well');
  });

  it('collapses the runs of whitespace tag removal leaves behind', () => {
    expect(stripWebSearchCitations('a  <cite index="1"/>  b')).toBe('a b');
  });

  it('handles several citations in one string', () => {
    expect(
      stripWebSearchCitations('<cite index="1">one</cite> and <cite index="2">two</cite>')
    ).toBe('one and two');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripWebSearchCitations('plain copy, unchanged')).toBe('plain copy, unchanged');
  });

  it('does not corrupt legitimate angle brackets', () => {
    expect(stripWebSearchCitations('5 > 3 and 2 < 4')).toBe('5 > 3 and 2 < 4');
  });
});

describe('sanitizeModelStrings', () => {
  it('walks nested objects and arrays', () => {
    const input = {
      a: '<cite index="1">one</cite>',
      b: { c: ['<cite index="2">two</cite>', 'three'] },
      d: 42,
      e: true,
      f: null,
    };
    expect(sanitizeModelStrings(input)).toEqual({
      a: 'one',
      b: { c: ['two', 'three'] },
      d: 42,
      e: true,
      f: null,
    });
  });

  it('preserves non-string primitives exactly', () => {
    expect(sanitizeModelStrings(0)).toBe(0);
    expect(sanitizeModelStrings(false)).toBe(false);
    expect(sanitizeModelStrings(null)).toBeNull();
    expect(sanitizeModelStrings(undefined)).toBeUndefined();
  });

  it('handles an empty object and array', () => {
    expect(sanitizeModelStrings({})).toEqual({});
    expect(sanitizeModelStrings([])).toEqual([]);
  });
});
