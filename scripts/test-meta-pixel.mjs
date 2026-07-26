/**
 * Headless Meta Pixel checks for keylo.co.uk (Section 2 tests 2.1–2.3).
 * Usage: node scripts/test-meta-pixel.mjs
 */
import { chromium } from 'playwright';

const PRODUCT_URL = 'https://keylo.co.uk/products/cream-of-dreams';
const EXPECTED_PIXEL_ID = '962658453483116';

function parseFbEvents(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('facebook.com')) return null;
    const ev = u.searchParams.get('ev');
    const cd = u.searchParams.get('cd');
    return { ev, cd: cd ? JSON.parse(cd) : null, url: url.slice(0, 200) };
  } catch {
    return { raw: url.slice(0, 200) };
  }
}

async function run() {
  const results = {
    pixelId: EXPECTED_PIXEL_ID,
    tests: {},
    events: [],
    errors: [],
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await context.newPage();

  const fbRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (
      url.includes('facebook.com/tr') ||
      url.includes('connect.facebook.net') ||
      url.includes('fbevents.js')
    ) {
      fbRequests.push({ type: 'request', url, method: req.method() });
    }
  });

  try {
    // 2.1 — Pixel installed on store
    await page.goto('https://keylo.co.uk', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);

    const fbqState = await page.evaluate(() => {
      const w = window;
      return {
        hasFbq: typeof w.fbq === 'function',
        fbqQueueLen: Array.isArray(w._fbq?.queue) ? w._fbq.queue.length : null,
        scripts: [...document.querySelectorAll('script[src*="facebook"]')].map((s) => s.src),
      };
    });

    const homeEvents = fbRequests.map((r) => parseFbEvents(r.url)).filter(Boolean);
    const shopifyPixel = await page.evaluate(() => {
      const w = window;
      return {
        hasFbq: typeof w.fbq === 'function',
        shopifyAnalytics: Boolean(w.Shopify?.analytics?.initialized),
        pixelIdInHtml: document.documentElement.innerHTML.includes('962658453483116'),
        wpmReplay: Boolean(w.Shopify?.analytics?.replayQueue),
      };
    });

    results.tests['2.1_config'] = {
      pass: shopifyPixel.pixelIdInHtml,
      ...shopifyPixel,
      configuredPixelId: EXPECTED_PIXEL_ID,
    };

    results.tests['2.1_home'] = {
      pass: fbqState.hasFbq || fbRequests.length > 0 || shopifyPixel.pixelIdInHtml,
      fbq: fbqState,
      fbRequestCount: fbRequests.length,
      events: homeEvents.map((e) => e.ev).filter(Boolean),
    };

    // 2.2 — ViewContent on product page
    fbRequests.length = 0;
    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);

    const productEvents = fbRequests
      .map((r) => parseFbEvents(r.url))
      .filter((e) => e && e.ev);

    const viewContent = productEvents.filter((e) => e.ev === 'ViewContent');
    const viewContentDetail = viewContent[0] ?? null;

    results.tests['2.2_viewContent'] = {
      pass: viewContent.length > 0,
      eventCount: viewContent.length,
      hasContentName: Boolean(
        viewContentDetail?.cd?.content_name || viewContentDetail?.cd?.content_ids
      ),
      hasValue: viewContentDetail?.cd?.value != null,
      hasCurrency: viewContentDetail?.cd?.currency != null,
      sample: viewContentDetail,
      allProductEvents: productEvents.map((e) => e.ev),
    };
    results.events.push(...productEvents);

    // 2.3 — AddToCart after click
    fbRequests.length = 0;
    const addBtn = page.locator('form[action*="/cart/add"] button[type="submit"]').first();
    const fallbackBtn = page.locator('button:has-text("Add to cart")').first();

    let addToCartFired = false;
    const btn = (await addBtn.count()) ? addBtn : fallbackBtn;
    if (await btn.count()) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ timeout: 15000, force: true });
      await page.waitForTimeout(5000);

      const cartEvents = fbRequests
        .map((r) => parseFbEvents(r.url))
        .filter((e) => e && e.ev);
      const addToCart = cartEvents.filter((e) => e.ev === 'AddToCart');
      addToCartFired = addToCart.length > 0;

      results.tests['2.3_addToCart'] = {
        pass: addToCartFired,
        eventCount: addToCart.length,
        hasValue: addToCart[0]?.cd?.value != null,
        hasContentIds: Boolean(addToCart[0]?.cd?.content_ids),
        sample: addToCart[0] ?? null,
        allCartEvents: cartEvents.map((e) => e.ev),
      };
      results.events.push(...cartEvents);
    } else {
      results.tests['2.3_addToCart'] = {
        pass: false,
        error: 'Add to cart button not found',
      };
    }

    // Pixel ID in page / network
    const pixelInNetwork = fbRequests.some((r) => r.url.includes(EXPECTED_PIXEL_ID));
    const pixelInPage = await page.evaluate((id) => {
      return document.documentElement.innerHTML.includes(id);
    }, EXPECTED_PIXEL_ID);

    results.tests['2.1_pixelId'] = {
      pass: pixelInNetwork || pixelInPage || fbqState.hasFbq,
      expected: EXPECTED_PIXEL_ID,
      inNetwork: pixelInNetwork,
      inHtml: pixelInPage,
    };
  } catch (err) {
    results.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }

  // 2.4 and 2.5 cannot be automated without checkout + Ads Manager
  results.tests['2.4_purchase'] = {
    pass: null,
    note: 'MANUAL — complete test checkout and check Pixel Helper on thank-you page + Events Manager after 2–4h',
  };
  results.tests['2.5_adsManager'] = {
    pass: null,
    note: 'MANUAL — Meta Ads Manager → campaign columns Cost per purchase / ROAS',
  };

  const scored = ['2.1_config', '2.1_home', '2.1_pixelId', '2.2_viewContent', '2.3_addToCart'];
  const passCount = scored.filter((k) => results.tests[k]?.pass === true).length;
  results.summary = {
    automatedPass: passCount,
    automatedTotal: scored.length,
    manualRequired: ['2.4_purchase', '2.5_adsManager'],
  };

  console.log(JSON.stringify(results, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
