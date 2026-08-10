import { chromium } from 'playwright';
import { cleanText, extractMoreProvidersCount, sleep } from './utils.js';

/**
 * Initializes and launches a headless Playwright Chromium browser instance.
 * @param {object} options 
 * @returns {Promise<import('playwright').Browser>}
 */
export async function initBrowser(options = {}) {
  const isHeadless = options.headless !== undefined ? options.headless : true;
  
  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1280,800'
    ]
  });

  return browser;
}

/**
 * Configures route interception to block non-essential resources (images, fonts, media, analytics).
 * @param {import('playwright').Page} page 
 */
export async function setupRouteInterception(page) {
  const blockedResourceTypes = new Set(['image', 'font', 'media']);
  const blockedUrlPatterns = [
    'google-analytics',
    'googletagmanager',
    'doubleclick',
    'facebook.net',
    'analytics',
    'telemetry',
    'hotjar',
    'mixpanel',
    'segment.io',
    'adsystem',
    'clarity.ms'
  ];

  await page.route('**/*', (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url().toLowerCase();

    if (blockedResourceTypes.has(resourceType)) {
      return route.abort();
    }

    const isTracker = blockedUrlPatterns.some((pattern) => url.includes(pattern));
    if (isTracker) {
      return route.abort();
    }

    return route.continue();
  });
}

/**
 * Extracts Provider Name from page DOM.
 * @param {import('playwright').Page} page 
 * @returns {Promise<string>}
 */
async function extractProviderName(page) {
  const selectors = [
    'h1.capital-words',
    'h1.greytext',
    'h1',
    '[class*="provider-name"]',
    '[class*="providerName"]',
    '[class*="doctor-name"]',
    '[class*="doctorName"]',
    '[class*="profile-header"] h1',
    '[class*="profileHeader"] h1'
  ];

  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 800 })) {
        const rawText = await element.textContent();
        const text = cleanText(rawText);
        if (text && text.length > 1 && !/404|not found/i.test(text)) {
          return text;
        }
      }
    } catch (_) {}
  }

  try {
    const name = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent.trim()) return h1.textContent.trim();
      return '';
    });
    if (name) return cleanText(name);
  } catch (_) {}

  return '';
}

/**
 * Extracts Provider Title / Specialty / Credentials (e.g. "MD, Family Medicine") from page DOM.
 * @param {import('playwright').Page} page 
 * @returns {Promise<string>}
 */
async function extractProviderTitle(page) {
  try {
    const titleText = await page.evaluate(() => {
      // 1. Selector p.fnt12italic or italic classes below provider name
      const italicEl = document.querySelector('.fnt12italic, [class*="fnt12italic"], [class*="italic"]');
      if (italicEl && italicEl.textContent.trim()) {
        return italicEl.textContent.trim();
      }

      // 2. Look for p or div right after h1
      const h1 = document.querySelector('h1');
      if (h1) {
        let next = h1.nextElementSibling;
        while (next) {
          const text = next.textContent ? next.textContent.trim() : '';
          if (text && !/english|spanish|about|book an appointment|accepting new patients/i.test(text)) {
            return text;
          }
          next = next.nextElementSibling;
        }

        // 3. Parent container of h1 containing p tag
        const parent = h1.parentElement;
        if (parent) {
          const p = parent.querySelector('p');
          if (p && p.textContent.trim()) {
            return p.textContent.trim();
          }
        }
      }

      // 4. Fallback selectors for title / specialty
      const titleEl = document.querySelector('[class*="provider-title"], [class*="doctor-title"], [class*="specialty"]');
      if (titleEl && titleEl.textContent.trim()) {
        return titleEl.textContent.trim();
      }

      return '';
    });

    if (titleText) {
      return cleanText(titleText);
    }
  } catch (_) {}

  return '';
}

/**
 * Extracts Practice / Company Name(s) from page DOM.
 * If a provider works at multiple practices/locations, returns all practice names joined by newlines (\n).
 * @param {import('playwright').Page} page 
 * @returns {Promise<string>}
 */
async function extractPracticeName(page) {
  try {
    const practiceNamesList = await page.evaluate(() => {
      const names = [];

      // 1. Direct location list items (.location-list li, [class*="location-list"] li)
      const locList = Array.from(
        document.querySelectorAll(
          '.location-list li, [class*="location-list"] li, [class*="location-item"]'
        )
      );
      for (const item of locList) {
        const text = (item.innerText || '').trim();
        if (text) {
          const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
          if (lines.length > 0) {
            let firstLine = lines[0];
            // Remove trailing mileage/distance text like "< 1mi" if attached
            firstLine = firstLine.replace(/[<>]\s*\d+\s*mi/gi, '').trim();
            if (firstLine && firstLine.length > 1 && !/book an appointment|about/i.test(firstLine)) {
              names.push(firstLine);
            }
          }
        }
      }

      // 2. Fallback to practice containers if locList is empty
      if (names.length === 0) {
        const practiceEls = Array.from(
          document.querySelectorAll(
            '[class*="practice-name"], [class*="practiceName"], [class*="facility-name"], [class*="clinic-name"]'
          )
        );
        for (const el of practiceEls) {
          const text = (el.innerText || '').trim();
          if (text && !/book an appointment|about/i.test(text)) {
            const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
            if (lines.length > 0) names.push(lines[0]);
          }
        }
      }

      // Return unique names while maintaining order
      const uniqueNames = [];
      const seen = new Set();
      for (const name of names) {
        const cleaned = name.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned && !seen.has(cleaned.toLowerCase())) {
          seen.add(cleaned.toLowerCase());
          uniqueNames.push(cleaned);
        }
      }

      return uniqueNames;
    });

    if (practiceNamesList && practiceNamesList.length > 0) {
      return practiceNamesList.join('\n');
    }
  } catch (_) {}

  return '';
}

/**
 * Extracts "More Providers at this location" count from page DOM.
 * @param {import('playwright').Page} page 
 * @returns {Promise<number>}
 */
async function extractMoreProviders(page) {
  try {
    const count = await page.evaluate(() => {
      // 1. Direct span class .moreprovider
      const moreSpan = document.querySelector('.moreprovider, [class*="moreprovider"], [class*="more-provider"]');
      if (moreSpan && moreSpan.textContent.trim()) {
        const match = moreSpan.textContent.match(/(\d+)\s+More\s+Providers/i);
        if (match && match[1]) return parseInt(match[1], 10);
      }

      // 2. Check headings / titles
      const headers = Array.from(document.querySelectorAll('h2, h3, div, span, button, a'));
      for (const h of headers) {
        const text = (h.innerText || '').trim();
        if (/more\s+providers/i.test(text)) {
          const match = text.match(/(\d+)\s+More\s+Providers/i);
          if (match && match[1]) return parseInt(match[1], 10);
        }
      }

      return 0;
    });

    if (count > 0) return count;
  } catch (_) {}

  try {
    const fullText = await page.evaluate(() => document.body.innerText || '');
    const count = extractMoreProvidersCount(fullText);
    if (count > 0) return count;
  } catch (_) {}

  return 0;
}

/**
 * Extracts details of other providers at the location in format: Name - (Title) - URL
 * Multiple providers are joined by newlines (\n).
 * @param {import('playwright').Page} page 
 * @returns {Promise<string>}
 */
async function extractOtherProvidersDetails(page) {
  try {
    // Scroll down to trigger lazy loading of provider cards
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const detailsText = await page.evaluate(() => {
      const results = [];
      const seenSlugs = new Set();

      const providerEls = Array.from(
        document.querySelectorAll('.provider-card, [onclick*="openProviderProfile"]')
      );

      for (const el of providerEls) {
        const onclickAttr = el.getAttribute('onclick') || '';
        const match = onclickAttr.match(/openProviderProfile\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
        if (!match || !match[1]) continue;

        const slug = match[1].trim();
        if (seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);

        const rawText = (el.innerText || '').trim();
        const lines = rawText.split('\n').map((s) => s.trim()).filter(Boolean);

        let name = lines[0] || '';
        let title = lines[1] || '';

        // Filter out language lines if present in second line
        if (/^(english|spanish|french|german|mandarin|hindi|vietnamese)$/i.test(title)) {
          title = '';
        }

        const fullUrl = `https://healow.com/apps/provider/${slug}`;

        if (name) {
          const formatted = title ? `${name} - (${title}) - ${fullUrl}` : `${name} - ${fullUrl}`;
          results.push(formatted);
        }
      }

      return results.join('\n');
    });

    return detailsText || '';
  } catch (_) {}

  return '';
}

/**
 * Scrapes a single Healow provider URL with retry logic and 404 detection.
 * @param {import('playwright').Browser} browser 
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<object>} Extracted fields and status
 */
export async function scrapeUrl(browser, url, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const timeoutMs = options.timeoutMs || 35000;
  
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let context = null;
    let page = null;

    try {
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      page = await context.newPage();
      await setupRouteInterception(page);

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });

      const httpStatus = response ? response.status() : 200;
      if (httpStatus === 404) {
        await context.close();
        return {
          url,
          providerName: '',
          title: '',
          practiceName: '',
          moreProvidersCount: 0,
          otherProvidersDetails: '',
          status: 'Failed',
          error: '404 Page Not Found'
        };
      }

      await page.waitForTimeout(1500);

      const is404Content = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return /404 error|was not found on our server|page not found/i.test(text);
      });

      if (is404Content) {
        await context.close();
        return {
          url,
          providerName: '',
          title: '',
          practiceName: '',
          moreProvidersCount: 0,
          otherProvidersDetails: '',
          status: 'Failed',
          error: '404 Page Not Found'
        };
      }

      const providerName = await extractProviderName(page);
      const title = await extractProviderTitle(page);
      const practiceName = await extractPracticeName(page);
      const moreProvidersCount = await extractMoreProviders(page);
      const otherProvidersDetails = await extractOtherProvidersDetails(page);

      await context.close();

      return {
        url,
        providerName,
        title,
        practiceName,
        moreProvidersCount,
        otherProvidersDetails,
        status: 'Success'
      };
    } catch (err) {
      lastError = err.message || String(err);
      if (context) {
        await context.close().catch(() => {});
      }

      if (attempt < maxRetries) {
        await sleep(1500 * attempt);
      }
    }
  }

  return {
    url,
    providerName: '',
    title: '',
    practiceName: '',
    moreProvidersCount: 0,
    otherProvidersDetails: '',
    status: 'Failed',
    error: lastError
  };
}
