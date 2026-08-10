import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { readInputCsv, getCompletedUrls, CsvWriter } from './csv.js';
import { initBrowser, scrapeUrl } from './scraper.js';
import { formatElapsedTime, logProgress } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3005;

// Setup upload storage
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Global state for scraping job
let isScraping = false;
let shouldStop = false;
let currentJob = {
  status: 'idle', // 'idle' | 'running' | 'completed' | 'stopped'
  inputFile: 'ECW-copy - Sheet1.csv',
  outputFile: 'output.csv',
  failedFile: 'failed.csv',
  totalUrls: 0,
  processedCount: 0,
  successCount: 0,
  failedCount: 0,
  startTime: null,
  elapsedTime: '00:00:00',
  currentResults: []
};

// SSE Clients list
let sseClients = [];

function broadcastSSE(data) {
  sseClients.forEach((client) => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// SSE Connection Endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial status
  res.write(`data: ${JSON.stringify({ type: 'status', job: currentJob })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c.id !== clientId);
  });
});

// Upload CSV file or paste URLs
app.post('/api/upload', upload.single('csvFile'), async (req, res) => {
  try {
    let targetPath = 'input.csv';

    if (req.file) {
      targetPath = req.file.path;
    } else if (req.body.urlsText) {
      const urls = req.body.urlsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const csvContent = 'URL\n' + urls.join('\n');
      targetPath = 'uploads/pasted_input.csv';
      fs.writeFileSync(targetPath, csvContent, 'utf8');
    }

    const loadedUrls = await readInputCsv(targetPath);
    isScraping = false;
    shouldStop = false;
    currentJob.inputFile = targetPath;
    currentJob.totalUrls = loadedUrls.length;
    currentJob.processedCount = 0;
    currentJob.successCount = 0;
    currentJob.failedCount = 0;
    currentJob.elapsedTime = '00:00:00';
    currentJob.currentResults = [];
    currentJob.status = 'idle';

    broadcastSSE({
      type: 'status',
      job: currentJob
    });

    res.json({
      success: true,
      urlCount: loadedUrls.length,
      message: `Loaded ${loadedUrls.length} valid target URLs.`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Start Scraping Job
app.post('/api/start', async (req, res) => {
  if (isScraping) {
    return res.status(400).json({ success: false, error: 'Job is already running!' });
  }

  const concurrency = parseInt(req.body.concurrency || 5, 10);
  const inputFile = currentJob.inputFile || (fs.existsSync('ECW-copy - Sheet1.csv') ? 'ECW-copy - Sheet1.csv' : 'input.csv');

  isScraping = true;
  shouldStop = false;
  currentJob.status = 'running';
  currentJob.startTime = Date.now();
  currentJob.processedCount = 0;
  currentJob.successCount = 0;
  currentJob.failedCount = 0;
  currentJob.currentResults = [];

  res.json({ success: true, message: 'Scraper execution started!' });

  // Run scraper process asynchronously
  runScraperProcess(inputFile, concurrency).catch((err) => {
    console.error('Scraper Process Error:', err);
    broadcastSSE({ type: 'error', error: err.message });
  });
});

// Stop Scraping Job
app.post('/api/stop', (req, res) => {
  shouldStop = true;
  isScraping = false;
  currentJob.status = 'idle';

  broadcastSSE({
    type: 'status',
    job: currentJob
  });

  res.json({ success: true, message: 'Stopping scraper gracefully...' });
});

// Download Output CSV
app.get('/api/download/output', (req, res) => {
  const filePath = path.join(__dirname, 'output.csv');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'output.csv');
  } else {
    res.status(404).json({ error: 'output.csv not found' });
  }
});

// Download Failed CSV
app.get('/api/download/failed', (req, res) => {
  const filePath = path.join(__dirname, 'failed.csv');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'failed.csv');
  } else {
    res.status(404).json({ error: 'failed.csv not found' });
  }
});

// Reset output.csv and failed.csv files
app.post('/api/reset-output', (req, res) => {
  if (isScraping) {
    return res.status(400).json({ success: false, error: 'Cannot reset output while scraping job is running.' });
  }

  try {
    const outputHeader = 'URL,Provider Name,Title,Practice Name,More Providers Count,Other Providers Details,Status\n';
    const failedHeader = 'URL,Error,Timestamp\n';

    fs.writeFileSync('output.csv', outputHeader, 'utf8');
    fs.writeFileSync('failed.csv', failedHeader, 'utf8');

    currentJob.processedCount = 0;
    currentJob.successCount = 0;
    currentJob.failedCount = 0;
    currentJob.elapsedTime = '00:00:00';
    currentJob.currentResults = [];
    currentJob.status = 'idle';

    broadcastSSE({
      type: 'status',
      job: currentJob
    });

    res.json({ success: true, message: 'output.csv and failed.csv have been reset successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Status Endpoint
app.get('/api/status', (req, res) => {
  res.json(currentJob);
});

/**
 * Main scraper worker pool execution for web app
 */
async function runScraperProcess(inputFile, concurrencyLimit) {
  let allUrls = [];
  try {
    allUrls = await readInputCsv(inputFile);
  } catch (err) {
    isScraping = false;
    currentJob.status = 'error';
    broadcastSSE({ type: 'error', error: `Input read error: ${err.message}` });
    return;
  }

  currentJob.totalUrls = allUrls.length;
  const completedUrlsSet = await getCompletedUrls('output.csv');
  const remainingUrls = allUrls.filter((url) => !completedUrlsSet.has(url));

  currentJob.processedCount = completedUrlsSet.size;

  broadcastSSE({
    type: 'log',
    message: `Loaded ${allUrls.length} URLs. ${completedUrlsSet.size} already completed. ${remainingUrls.length} remaining.`
  });

  if (remainingUrls.length === 0) {
    isScraping = false;
    currentJob.status = 'completed';
    broadcastSSE({ type: 'complete', message: 'All URLs have already been processed!' });
    return;
  }

  const csvWriter = new CsvWriter('output.csv', 'failed.csv');
  broadcastSSE({ type: 'log', message: 'Launching Playwright Chromium browser instance...' });
  const browser = await initBrowser({ headless: true });

  let queueIndex = 0;
  let activeWorkers = 0;

  async function worker(workerId) {
    activeWorkers++;
    while (queueIndex < remainingUrls.length && !shouldStop) {
      const currentIndex = queueIndex++;
      const url = remainingUrls[currentIndex];
      if (!url) break;

      try {
        const result = await scrapeUrl(browser, url, { maxRetries: 3 });

        currentJob.processedCount++;
        if (result.status === 'Success') {
          currentJob.successCount++;
          await csvWriter.writeSuccessRecord(result);
        } else {
          currentJob.failedCount++;
          await csvWriter.writeFailedRecord(result);
        }

        currentJob.elapsedTime = formatElapsedTime(Date.now() - currentJob.startTime);
        if (currentJob.currentResults.length >= 100) {
          currentJob.currentResults.shift();
        }
        currentJob.currentResults.push(result);

        broadcastSSE({
          type: 'progress',
          job: currentJob,
          latestResult: result
        });
      } catch (err) {
        console.error(`Worker error on URL ${url}:`, err);
        currentJob.processedCount++;
        currentJob.failedCount++;
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
        broadcastSSE({
          type: 'progress',
          job: currentJob,
          latestResult: failRecord
        });
      }
    }
    activeWorkers--;
  }

  const workers = [];
  for (let i = 0; i < concurrencyLimit; i++) {
    workers.push(worker(i + 1));
  }

  await Promise.all(workers);

  await csvWriter.flush();
  await browser.close().catch(() => {});

  isScraping = false;
  currentJob.status = shouldStop ? 'stopped' : 'completed';

  broadcastSSE({
    type: 'complete',
    job: currentJob,
    message: shouldStop ? 'Scraping job stopped by user.' : 'Scraping Job Complete!'
  });
}

app.listen(PORT, async () => {
  const defaultFile = fs.existsSync('ECW-copy - Sheet1.csv') ? 'ECW-copy - Sheet1.csv' : 'input.csv';
  try {
    const urls = await readInputCsv(defaultFile);
    currentJob.inputFile = defaultFile;
    currentJob.totalUrls = urls.length;
  } catch (_) {}

  console.log(`==================================================`);
  console.log(`  Healow Playwright Web Dashboard running on:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`==================================================`);

  // Automatically open browser on macOS / Windows
  const openCmd = process.platform === 'win32' ? `start http://localhost:${PORT}` : process.platform === 'darwin' ? `open http://localhost:${PORT}` : `xdg-open http://localhost:${PORT}`;
  exec(openCmd, () => {});
});
