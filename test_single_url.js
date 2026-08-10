import { chromium } from 'playwright';
import { scrapeUrl } from './scraper.js';

async function testExtract() {
  const browser = await chromium.launch({ headless: true });
  const result = await scrapeUrl(browser, 'https://healow.com/apps/provider/t-gentner-9113');
  console.log('Scraped Result:', result);
  await browser.close();
}

testExtract();
