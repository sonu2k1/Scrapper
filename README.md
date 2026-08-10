# Healow Provider Playwright Web Scraper

A production-ready, highly efficient, and resilient web scraper built with **Node.js** and **Playwright** designed to extract provider details from over 8,000 Healow profile URLs.

---

## Features

- **High Performance & Concurrency**: Spawns **5 concurrent Playwright browser pages** to scrape multiple provider URLs in parallel.
- **Resource Optimization**: Blocks non-essential network assets (images, web fonts, media files, tracking scripts, doubleclick, google-analytics) to achieve maximum page load speed.
- **Robust Field Extraction**:
  - `URL`: Target Healow profile URL.
  - `Provider Name`: e.g., *Kristina Schnitzer*.
  - `Title`: Credentials / degree / specialty below doctor name, e.g., *MD, Family Medicine*.
  - `Practice Name`: Practice / facility / clinic names. If a provider has multiple practice locations, all locations are extracted and separated by newlines (`\n`) within the cell.
  - `More Providers Count`: Parses exact integer from *"57 More Providers at this location"* (returns `0` if not present).
  - `Status`: `Success` or `Failed`.
- **Resume Support & Auto-Save**: Automatically checks existing `output.csv` on startup and skips previously scraped URLs. Automatically saves progress every 50 URLs and flushes buffers safely on termination.
- **Retries & Error Handling**: Retries broken or timed-out pages up to **3 times** with exponential backoff. Logs unrecoverable errors to `failed.csv` without interrupting execution.
- **Detailed Progress Logging**: Real-time terminal output displaying current step count, URL, extracted fields, and total elapsed time.

---

## Project Structure

```
ECW-Scrapper/
├── main.js        # Entry point: Orchestrates concurrency worker pool, queue, and resume logic
├── scraper.js     # Scraping engine: Playwright browser management, route interception, selector extraction
├── csv.js         # CSV I/O handler: Fast streaming CSV parsing (csv-parser) and writing (fast-csv)
├── utils.js       # Utility functions: Text cleaning, regex parsing, duration formatting, logger
├── package.json   # Project manifest and ES module dependencies
├── README.md      # Documentation and usage guide
├── input.csv      # Target input URLs (8,000+ Healow links)
├── output.csv     # Scraped results output
└── failed.csv     # Log of failed URLs and error reasons
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

---

## Installation Steps

1. **Clone or Navigate to Project Directory**:
   ```bash
   cd ECW-Scrapper
   ```

2. **Install Node Dependencies**:
   ```bash
   npm install
   ```

3. **Install Playwright Chromium Browser**:
   ```bash
   npx playwright install chromium
   ```

---

## Usage

### 1. Prepare Input CSV

Place your input CSV file named `input.csv` in the root project directory (or export your Google Sheet as CSV).

Example `input.csv`:
```csv
URL
https://healow.com/apps/jsp/onlinebooking/knowyourdoctor.jsp?shortUrl=...
https://healow.com/apps/jsp/onlinebooking/knowyourdoctor.jsp?shortUrl=...
```

> **Note**: The input reader automatically detects `URL`, `url`, `Url`, `link`, or uses the first column if headers differ.

### 2. Start the Scraper

Run the start command:

```bash
npm start
```

Or execute directly:

```bash
node main.js
```

### Terminal Output Preview

```text
==================================================
       Healow Provider Playwright Scraper        
==================================================
Input File:       input.csv
Output File:      output.csv
Failed File:      failed.csv
Concurrency:      5 pages
--------------------------------------------------
Loaded 8000 URLs from input.csv
Already completed: 0
Remaining to process: 8000
--------------------------------------------------
Launching Playwright Chromium browser...
--------------------------------------------------
[1/8000]
Current URL: https://healow.com/apps/jsp/...
Provider:    Kristina Schnitzer
Practice:    The Austin Diagnostic Clinic Association PLLC
Providers:   57
Elapsed Time: 00:00:03
--------------------------------------------------
[2/8000]
Current URL: https://healow.com/apps/jsp/...
Provider:    John Smith
Practice:    Austin Healthcare Group
Providers:   12
Elapsed Time: 00:00:04
```

---

## Output CSV Formats

### `output.csv`

| URL | Provider Name | Title | Practice Name | More Providers Count | Other Providers Details | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `https://healow.com/apps/jsp/...` | Timothy Gentner | MD, Family Medicine | CMG FP-Carson | 19 | Sarah Holloman - (PAC, Family Medicine) - https://healow.com/apps/provider/sarah-holloman-3566266... | Success |
| `https://healow.com/apps/jsp/...` | Jane Doe | MD, Pediatrics | Wellness Clinic LLC | 0 | | Success |

### `failed.csv`

| URL | Error | Timestamp |
| :--- | :--- | :--- |
| `https://healow.com/apps/jsp/broken` | Navigation timeout of 35000ms exceeded | 2026-08-07T11:20:00.000Z |

---

## Resilience & Interruptions

- If you press `Ctrl + C` (SIGINT) or the process receives `SIGTERM`, the scraper will safely flush all buffered results to `output.csv` and `failed.csv` before closing the browser.
- Running `npm start` again will **resume** from where it left off, automatically skipping all URLs recorded in `output.csv`.
