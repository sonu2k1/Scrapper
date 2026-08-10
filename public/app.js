document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const tabUpload = document.getElementById('tabUpload');
  const tabPaste = document.getElementById('tabPaste');
  const uploadForm = document.getElementById('uploadForm');
  const pasteForm = document.getElementById('pasteForm');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileName = document.getElementById('fileName');
  const urlsTextarea = document.getElementById('urlsTextarea');
  const btnUploadSubmit = document.getElementById('btnUploadSubmit');

  const concurrencyInput = document.getElementById('concurrencyInput');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const statusBadge = document.getElementById('statusBadge');

  const statTotal = document.getElementById('statTotal');
  const statProcessed = document.getElementById('statProcessed');
  const statSuccess = document.getElementById('statSuccess');
  const statFailed = document.getElementById('statFailed');
  const statElapsed = document.getElementById('statElapsed');

  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');

  const terminalLog = document.getElementById('terminalLog');
  const btnClearLog = document.getElementById('btnClearLog');

  const resultsTbody = document.getElementById('resultsTbody');
  const tableSearch = document.getElementById('tableSearch');

  let resultsData = [];
  let eventSource = null;

  // Tabs Toggle
  tabUpload.addEventListener('click', () => {
    tabUpload.classList.add('active');
    tabPaste.classList.remove('active');
    uploadForm.classList.add('active');
    pasteForm.classList.remove('active');
  });

  tabPaste.addEventListener('click', () => {
    tabPaste.classList.add('active');
    tabUpload.classList.remove('active');
    pasteForm.classList.add('active');
    uploadForm.classList.remove('active');
  });

  // File Input Change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      fileName.textContent = fileInput.files[0].name;
    } else {
      fileName.textContent = 'No file selected';
    }
  });

  // Upload Submit
  btnUploadSubmit.addEventListener('click', async () => {
    const formData = new FormData();

    if (tabUpload.classList.contains('active')) {
      if (!fileInput.files[0]) {
        addLog('Please select a CSV file first!', 'error');
        return;
      }
      formData.append('csvFile', fileInput.files[0]);
    } else {
      const text = urlsTextarea.value.trim();
      if (!text) {
        addLog('Please paste URLs first!', 'error');
        return;
      }
      formData.append('urlsText', text);
    }

    btnUploadSubmit.disabled = true;
    btnUploadSubmit.textContent = 'Loading...';

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        addLog(`[Success] ${data.message}`, 'success');
        statTotal.textContent = data.urlCount;
      } else {
        addLog(`[Error] ${data.error}`, 'error');
      }
    } catch (err) {
      addLog(`[Error] Upload failed: ${err.message}`, 'error');
    } finally {
      btnUploadSubmit.disabled = false;
      btnUploadSubmit.textContent = 'Load Input URLs';
    }
  });

  // Start Scraper
  btnStart.addEventListener('click', async () => {
    const concurrency = concurrencyInput.value || 5;

    btnStart.disabled = true;
    btnStop.disabled = false;

    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrency })
      });
      const data = await res.json();

      if (data.success) {
        addLog(`[Job Started] Scraper running with concurrency ${concurrency}`, 'info');
        updateStatusBadge('running');
      } else {
        addLog(`[Error] ${data.error}`, 'error');
        btnStart.disabled = false;
        btnStop.disabled = true;
      }
    } catch (err) {
      addLog(`[Error] Could not start scraper: ${err.message}`, 'error');
      btnStart.disabled = false;
      btnStop.disabled = true;
    }
  });

  // Stop Scraper
  btnStop.addEventListener('click', async () => {
    btnStop.disabled = true;
    addLog('[System] Sending stop signal to scraper workers...', 'info');

    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog(`[System] ${data.message}`, 'info');
      }
    } catch (err) {
      addLog(`[Error] Stop request failed: ${err.message}`, 'error');
    }
  });

  async function safeFetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Server returned HTML response (404/Error). Make sure you are accessing http://localhost:3005`);
    }
    return await res.json();
  }

  // Reset Output CSV
  const btnResetOutput = document.getElementById('btnResetOutput');
  if (btnResetOutput) {
    btnResetOutput.addEventListener('click', async () => {
      const confirmed = confirm('Are you sure you want to reset output.csv and failed.csv? This will clear previous results so you can start fresh.');
      if (!confirmed) return;

      btnResetOutput.disabled = true;
      try {
        const data = await safeFetchJson('/api/reset-output', { method: 'POST' });
        if (data.success) {
          addLog(`[Reset] ${data.message}`, 'success');
          resultsData = [];
          renderTable();
          statProcessed.textContent = '0';
          statSuccess.textContent = '0';
          statFailed.textContent = '0';
          statElapsed.textContent = '00:00:00';
          progressPercent.textContent = '0%';
          progressBarFill.style.width = '0%';
        } else {
          addLog(`[Error] Reset failed: ${data.error}`, 'error');
        }
      } catch (err) {
        addLog(`[Error] Reset request failed: ${err.message}`, 'error');
      } finally {
        btnResetOutput.disabled = false;
      }
    });
  }

  // Clear Log
  btnClearLog.addEventListener('click', () => {
    terminalLog.innerHTML = '';
  });

  // Search Filter in Table
  tableSearch.addEventListener('input', () => {
    renderTable();
  });

  // Connect SSE
  connectSSE();

  function connectSSE() {
    eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSSEPayload(payload);
      } catch (e) {
        console.error('SSE Error:', e);
      }
    };

    eventSource.onerror = () => {
      console.warn('SSE Disconnected. Reconnecting...');
    };
  }

  function handleSSEPayload(payload) {
    if (payload.type === 'status' || payload.type === 'progress') {
      const job = payload.job;
      if (job) {
        statTotal.textContent = job.totalUrls || 0;
        statProcessed.textContent = job.processedCount || 0;
        statSuccess.textContent = job.successCount || 0;
        statFailed.textContent = job.failedCount || 0;
        statElapsed.textContent = job.elapsedTime || '00:00:00';

        const percent = job.totalUrls > 0 ? Math.round((job.processedCount / job.totalUrls) * 100) : 0;
        progressPercent.textContent = `${percent}%`;
        progressBarFill.style.width = `${percent}%`;

        updateStatusBadge(job.status);

        if (job.status === 'running') {
          btnStart.disabled = true;
          btnStop.disabled = false;
        } else {
          btnStart.disabled = false;
          btnStop.disabled = true;
        }

        if (job.currentResults) {
          resultsData = job.currentResults;
          renderTable();
        }
      }

      if (payload.latestResult) {
        const r = payload.latestResult;
        const statusText = r.status === 'Success' ? `SUCCESS [${r.providerName || 'N/A'}]` : `FAILED [${r.error || 'Err'}]`;
        const logClass = r.status === 'Success' ? 'success' : 'error';
        addLog(`[URL] ${r.url} -> ${statusText}`, logClass);
      }
    } else if (payload.type === 'log') {
      addLog(`[Server] ${payload.message}`, 'info');
    } else if (payload.type === 'complete') {
      addLog(`[Complete] ${payload.message || 'Scraping job finished.'}`, 'success');
      updateStatusBadge('completed');
      btnStart.disabled = false;
      btnStop.disabled = true;
    } else if (payload.type === 'error') {
      addLog(`[Fatal Error] ${payload.error}`, 'error');
      updateStatusBadge('stopped');
      btnStart.disabled = false;
      btnStop.disabled = true;
    }
  }

  function addLog(text, type = 'info') {
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.textContent = text;
    terminalLog.appendChild(div);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  function updateStatusBadge(status) {
    statusBadge.className = 'status-badge';
    if (status === 'running') {
      statusBadge.classList.add('running');
      statusBadge.textContent = 'Scraping Active';
    } else if (status === 'stopped') {
      statusBadge.classList.add('stopped');
      statusBadge.textContent = 'Stopped';
    } else if (status === 'completed') {
      statusBadge.classList.add('completed');
      statusBadge.textContent = 'Completed';
    } else {
      statusBadge.textContent = 'Idle';
    }
  }

  function renderTable() {
    const query = tableSearch.value.toLowerCase().trim();
    const filtered = resultsData.filter((row) => {
      if (!query) return true;
      return (
        (row.providerName || '').toLowerCase().includes(query) ||
        (row.practiceName || '').toLowerCase().includes(query) ||
        (row.title || '').toLowerCase().includes(query) ||
        (row.otherProvidersDetails || '').toLowerCase().includes(query) ||
        (row.url || '').toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      resultsTbody.innerHTML = `<tr><td colspan="7" class="empty-msg">No matching scraped records found.</td></tr>`;
      return;
    }

    resultsTbody.innerHTML = filtered
      .slice(-50)
      .reverse()
      .map((row, idx) => {
        const badge = row.status === 'Success' ? '<span class="badge-status badge-success">Success</span>' : '<span class="badge-status badge-failed">Failed</span>';
        return `
          <tr>
            <td>${filtered.length - idx}</td>
            <td><strong>${escapeHtml(row.providerName || 'N/A')}</strong></td>
            <td>${escapeHtml(row.title || 'N/A')}</td>
            <td>${escapeHtml(row.practiceName || 'N/A')}</td>
            <td>${row.moreProvidersCount !== undefined ? row.moreProvidersCount : 0}</td>
            <td><small>${escapeHtml(row.otherProvidersDetails || 'N/A')}</small></td>
            <td>${badge}</td>
          </tr>
        `;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
