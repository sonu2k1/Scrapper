/**
 * Utility functions for Healow Playwright Scraper
 */

/**
 * Formats elapsed milliseconds into HH:MM:SS format
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted duration
 */
export function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Sanitizes and cleans text strings by removing extra spaces, tabs, and newlines.
 * @param {string|null|undefined} str 
 * @returns {string}
 */
export function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts numeric provider count from text like "57 More Providers at this location"
 * Returns 0 if no count is found.
 * @param {string|null|undefined} text 
 * @returns {number} Extracted count
 */
export function extractMoreProvidersCount(text) {
  if (!text) return 0;
  const cleaned = cleanText(text);
  
  // Match patterns like "57 More Providers", "124 More Providers at this location", "57 More Providers"
  const match = cleaned.match(/(\d+)\s+More\s+Providers/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  // Fallback match for pure digit followed by "More" or standalone digits in section header
  const digitMatch = cleaned.match(/^(\d+)$/) || cleaned.match(/(\d+)\s+providers/i);
  if (digitMatch && digitMatch[1]) {
    return parseInt(digitMatch[1], 10);
  }

  return 0;
}

/**
 * Delay execution for a given number of milliseconds
 * @param {number} ms 
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Formats and prints progress log to standard output
 * @param {number} current - Current completed count
 * @param {number} total - Total URL count
 * @param {object} data - Extracted profile data
 * @param {number} startTime - Epoch start timestamp
 */
export function logProgress(current, total, data, startTime) {
  const elapsed = formatElapsedTime(Date.now() - startTime);
  console.log(`--------------------------------------------------`);
  console.log(`[${current}/${total}]`);
  console.log(`Current URL: ${data.url || ''}`);
  console.log(`Provider:    ${data.providerName || 'N/A'}`);
  console.log(`Title:       ${data.title || 'N/A'}`);
  console.log(`Practice:    ${(data.practiceName || data.companyName || 'N/A').replace(/\n/g, ' | ')}`);
  console.log(`Providers:   ${data.moreProvidersCount !== undefined ? data.moreProvidersCount : 0}`);
  if (data.otherProvidersDetails) {
    const count = data.otherProvidersDetails.split('\n').length;
    console.log(`Other Details:${count} provider(s) details extracted`);
  }
  console.log(`Elapsed Time: ${elapsed}`);
  if (data.status === 'Failed') {
    console.log(`Status:      FAILED (${data.error || 'Unknown Error'})`);
  }
}
