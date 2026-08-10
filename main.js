import fs from 'fs';
import path from 'path';
import { readInputCsv, getCompletedUrls, CsvWriter } from './csv.js';
import { initBrowser, scrapeUrl } from './scraper.js';
import { logProgress } from './utils.js';

const CONCURRENCY_LIMIT = 5;

// Automatically detect user sheet if present, or fallback to input.csv
const defaultInputFile = fs.existsSync('ECW-copy - Sheet1.csv') ? 'ECW-copy - Sheet1.csv' : 'input.csv';
const INPUT_FILE = process.env.INPUT_CSV || defaultInputFile;
const OUTPUT_FILE = process.env.OUTPUT_CSV || 'output.csv';
const FAILED_FILE = process.env.FAILED_CSV || 'failed.csv';
const SAVE_INTERVAL = 50; // Progress auto-save log counter milestone

async function main() {
  const startTime = Date.now();
  console.log('==================================================');
  console.log('       Healow Provider Playwright Scraper        ');
  console.log('==================================================');
  console.log(`Input File:       ${INPUT_FILE}`);
  console.log(`Output File:      ${OUTPUT_FILE}`);
  console.log(`Failed File:      ${FAILED_FILE}`);
  console.log(`Concurrency:      ${CONCURRENCY_LIMIT} pages`);
  console.log('--------------------------------------------------');

  // 1. Read input CSV
  let allUrls = [];
  try {
    allUrls = await readInputCsv(INPUT_FILE);
    console.log(`Loaded ${allUrls.length} URLs from ${INPUT_FILE}`);
  } catch (err) {
    console.error(`Error loading input file: ${err.message}`);
    console.error(`Please provide a valid '${INPUT_FILE}' in the project root.`);
    process.exit(1);
  }

  if (allUrls.length === 0) {
    console.warn(`No valid URLs found in ${INPUT_FILE}. Exiting.`);
    process.exit(0);
  }

  // 2. Check resume mode (read completed URLs)
  const completedUrlsSet = await getCompletedUrls(OUTPUT_FILE);
  const remainingUrls = allUrls.filter((url) => !completedUrlsSet.has(url));

  console.log(`Already completed: ${completedUrlsSet.size}`);
  console.log(`Remaining to process: ${remainingUrls.length}`);
  console.log('--------------------------------------------------');

  if (remainingUrls.length === 0) {
    console.log('All URLs have already been processed! Nothing to do.');
    process.exit(0);
  }

  // 3. Initialize CSV Writer
  const csvWriter = new CsvWriter(OUTPUT_FILE, FAILED_FILE);

  // 4. Initialize Browser
  console.log('Launching Playwright Chromium browser...');
  const browser = await initBrowser({ headless: true });

  let processedCount = completedUrlsSet.size;
  const totalCount = allUrls.length;
  let queueIndex = 0;

  /**
   * Worker function processing URL queue
   */
  async function worker(workerId) {
    while (queueIndex < remainingUrls.length) {
      const currentIndex = queueIndex++;
      const url = remainingUrls[currentIndex];

      if (!url) break;

      try {
        const result = await scrapeUrl(browser, url, { maxRetries: 3 });

        processedCount++;

        // Save result to CSV
        if (result.status === 'Success') {
          await csvWriter.writeSuccessRecord(result);
        } else {
          await csvWriter.writeFailedRecord(result);
        }

        // Display logging
        logProgress(processedCount, totalCount, result, startTime);

        if (processedCount % SAVE_INTERVAL === 0) {
          console.log(`>>> Auto-save milestone reached: ${processedCount}/${totalCount} processed <<<`);
        }
      } catch (err) {
        console.error(`Unexpected worker error on URL [${url}]:`, err);
        processedCount++;
        const failRecord = {
          url,
          providerName: '',
          title: '',
          practiceName: '',
          moreProvidersCount: 0,
          otherProvidersDetails: '',
          status: 'Failed',
          error: err.message || String(err)
        };
        await csvWriter.writeFailedRecord(failRecord);
        logProgress(processedCount, totalCount, failRecord, startTime);
      }
    }
  }

  // 5. Spawn worker pool
  const workers = [];
  for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
    workers.push(worker(i + 1));
  }

  // Handle graceful exit signals
  const cleanup = async () => {
    console.log('\nFlushing remaining CSV records and closing browser...');
    await csvWriter.flush();
    await browser.close().catch(() => {});
    console.log('Cleanup finished.');
  };

  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT signal.');
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM signal.');
    await cleanup();
    process.exit(0);
  });

  // Wait for all workers to finish
  await Promise.all(workers);

  // Final flush and cleanup
  await cleanup();

  console.log('==================================================');
  console.log(`Scraping Job Complete!`);
  console.log(`Total URLs processed: ${processedCount}/${totalCount}`);
  console.log(`Results saved to:    ${OUTPUT_FILE}`);
  console.log(`Failed URLs saved to: ${FAILED_FILE}`);
  console.log('==================================================');
}

main().catch((err) => {
  console.error('Fatal error in scraper execution:', err);
  process.exit(1);
});
