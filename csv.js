import fs from 'fs';
import csvParser from 'csv-parser';
import * as fastCsv from 'fast-csv';
import { cleanText } from './utils.js';

/**
 * Reads input URLs from a CSV file (e.g., input.csv or Google Sheet export).
 * Identifies column containing URLs ('URL', 'url', 'Url', 'link', or first column).
 * @param {string} filePath 
 * @returns {Promise<string[]>} Array of valid target URLs
 */
export function readInputCsv(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`Input file not found at path: ${filePath}`));
    }

    const urls = [];
    let detectedUrlKey = null;

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('headers', (headers) => {
        // Find matching header key for URL
        detectedUrlKey = headers.find((h) =>
          /^(url|href|link|provider_url|location_url)$/i.test(h.trim())
        );
        if (!detectedUrlKey && headers.length > 0) {
          detectedUrlKey = headers[0]; // Default to first column if header not explicitly named URL
        }
      })
      .on('data', (row) => {
        let rawUrl = '';
        if (detectedUrlKey && row[detectedUrlKey]) {
          rawUrl = row[detectedUrlKey];
        } else {
          // If row is plain key-value or no header matched
          const values = Object.values(row);
          if (values.length > 0) {
            rawUrl = values[0];
          }
        }

        const cleanedUrl = cleanText(rawUrl);
        if (cleanedUrl && cleanedUrl.startsWith('http')) {
          urls.push(cleanedUrl);
        }
      })
      .on('end', () => {
        resolve(urls);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Reads existing output.csv to extract set of already completed URLs for resume mode.
 * @param {string} outputPath 
 * @returns {Promise<Set<string>>} Set of completed URLs
 */
export function getCompletedUrls(outputPath) {
  return new Promise((resolve) => {
    const completedSet = new Set();

    if (!fs.existsSync(outputPath)) {
      return resolve(completedSet);
    }

    fs.createReadStream(outputPath)
      .pipe(csvParser())
      .on('data', (row) => {
        const urlKey = Object.keys(row).find((k) => /^url$/i.test(k.trim())) || Object.keys(row)[0];
        if (urlKey && row[urlKey]) {
          const url = cleanText(row[urlKey]);
          if (url) {
            completedSet.add(url);
          }
        }
      })
      .on('end', () => {
        resolve(completedSet);
      })
      .on('error', () => {
        // If error parsing (e.g. corrupt or empty file), return whatever set was collected
        resolve(completedSet);
      });
  });
}

/**
 * Thread-safe CSV Manager for writing output.csv and failed.csv
 */
export class CsvWriter {
  constructor(outputPath = 'output.csv', failedPath = 'failed.csv') {
    this.outputPath = outputPath;
    this.failedPath = failedPath;
    this.writeQueue = Promise.resolve();
    this.bufferedSuccessRecords = [];
    this.bufferedFailedRecords = [];

    this._ensureHeaders();
  }

  /**
   * Initializes CSV files with headers if they do not exist.
   */
  _ensureHeaders() {
    if (!fs.existsSync(this.outputPath) || fs.statSync(this.outputPath).size === 0) {
      const headerRow = 'URL,Provider Name,Title,Practice Name,More Providers Count,Other Providers Details,Status\n';
      fs.writeFileSync(this.outputPath, headerRow, 'utf8');
    }

    if (!fs.existsSync(this.failedPath) || fs.statSync(this.failedPath).size === 0) {
      const headerRow = 'URL,Error,Timestamp\n';
      fs.writeFileSync(this.failedPath, headerRow, 'utf8');
    }
  }

  /**
   * Enqueues a successful result to be written to output.csv
   * @param {object} record 
   */
  async writeSuccessRecord(record) {
    this.bufferedSuccessRecords.push({
      URL: record.url,
      'Provider Name': record.providerName || '',
      Title: record.title || '',
      'Practice Name': record.practiceName || record.companyName || '',
      'More Providers Count': record.moreProvidersCount !== undefined ? record.moreProvidersCount : 0,
      'Other Providers Details': record.otherProvidersDetails || '',
      Status: record.status || 'Success'
    });

    // Write to disk immediately via mutex queue
    return this.flush();
  }

  /**
   * Enqueues a failed result to be written to failed.csv (and output.csv with Status=Failed)
   * @param {object} record 
   */
  async writeFailedRecord(record) {
    this.bufferedSuccessRecords.push({
      URL: record.url,
      'Provider Name': record.providerName || '',
      Title: record.title || '',
      'Practice Name': record.practiceName || record.companyName || '',
      'More Providers Count': record.moreProvidersCount !== undefined ? record.moreProvidersCount : 0,
      'Other Providers Details': record.otherProvidersDetails || '',
      Status: 'Failed'
    });

    this.bufferedFailedRecords.push({
      URL: record.url,
      Error: record.error || 'Unknown error',
      Timestamp: new Date().toISOString()
    });

    return this.flush();
  }

  /**
   * Flushes buffered records synchronously to disk safely.
   */
  flush() {
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.bufferedSuccessRecords.length > 0) {
        const recordsToWrite = [...this.bufferedSuccessRecords];
        this.bufferedSuccessRecords = [];

        const csvString = await fastCsv.writeToString(recordsToWrite, { headers: false });
        fs.appendFileSync(this.outputPath, csvString + '\n', 'utf8');
      }

      if (this.bufferedFailedRecords.length > 0) {
        const recordsToWrite = [...this.bufferedFailedRecords];
        this.bufferedFailedRecords = [];

        const csvString = await fastCsv.writeToString(recordsToWrite, { headers: false });
        fs.appendFileSync(this.failedPath, csvString + '\n', 'utf8');
      }
    }).catch((err) => {
      console.error('CSV Write Flush Error:', err);
    });

    return this.writeQueue;
  }
}
