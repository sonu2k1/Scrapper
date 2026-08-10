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
        statProcessed.textContent = '0';
        statSuccess.textContent = '0';
        statFailed.textContent = '0';
        progressPercent.textContent = '0%';
        progressBarFill.style.width = '0%';
        btnStart.disabled = false;
        btnStop.disabled = true;
        updateStatusBadge('idle');
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

  const btnPause = document.getElementById('btnPause');
  const btnPauseText = document.getElementById('btnPauseText');

  // Resume Modal Elements
  const resumeModal = document.getElementById('resumeModal');
  const resumeModalDesc = document.getElementById('resumeModalDesc');
  const prevOutputFileInput = document.getElementById('prevOutputFileInput');
  const prevOutputFileName = document.getElementById('prevOutputFileName');
  const btnChoiceResume = document.getElementById('btnChoiceResume');
  const btnChoiceFresh = document.getElementById('btnChoiceFresh');
  const btnChoiceCancel = document.getElementById('btnChoiceCancel');

  function openResumeModal() {
    if (resumeModal) resumeModal.classList.add('active');
  }

  function closeResumeModal() {
    if (resumeModal) resumeModal.classList.remove('active');
  }

  if (prevOutputFileInput) {
    prevOutputFileInput.addEventListener('change', () => {
      if (prevOutputFileInput.files.length > 0) {
        prevOutputFileName.textContent = prevOutputFileInput.files[0].name;
      } else {
        prevOutputFileName.textContent = 'No custom output file selected';
      }
    });
  }

  if (btnChoiceCancel) {
    btnChoiceCancel.addEventListener('click', closeResumeModal);
  }

  async function executeStartScraping(concurrency, resumeMode) {
    btnStart.disabled = true;
    if (btnPause) btnPause.disabled = false;
    btnStop.disabled = false;

    try {
      const data = await safeFetchJson('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrency, resumeMode })
      });

      if (data.success) {
        const modeText = resumeMode ? 'Resuming progress (skipping completed)' : 'Starting fresh';
        addLog(`[Job Started] ${modeText} with concurrency ${concurrency}`, 'info');
        updateStatusBadge('running');
      } else {
        addLog(`[Error] ${data.error}`, 'error');
        btnStart.disabled = false;
        if (btnPause) btnPause.disabled = true;
        btnStop.disabled = true;
      }
    } catch (err) {
      addLog(`[Error] Could not start scraper: ${err.message}`, 'error');
      btnStart.disabled = false;
      if (btnPause) btnPause.disabled = true;
      btnStop.disabled = true;
    }
  }

  // Start Scraper Button Click
  btnStart.addEventListener('click', async () => {
    const concurrency = concurrencyInput.value || 5;

    try {
      const checkData = await safeFetchJson('/api/check-previous');
      if (checkData.hasPrevious) {
        if (resumeModalDesc) {
          resumeModalDesc.innerHTML = `Bhai, pichli baar ka scraped data mila hai (<strong>${checkData.completedCount} completed records</strong> in output.csv). Kya aap wahan se continue karna chahte hain jahan chhoda tha?`;
        }
        openResumeModal();
      } else {
        await executeStartScraping(concurrency, false);
      }
    } catch (err) {
      await executeStartScraping(concurrency, false);
    }
  });

  // Modal Resume Choice Click
  if (btnChoiceResume) {
    btnChoiceResume.addEventListener('click', async () => {
      closeResumeModal();
      const concurrency = concurrencyInput.value || 5;

      if (prevOutputFileInput && prevOutputFileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('outputFile', prevOutputFileInput.files[0]);
        btnChoiceResume.disabled = true;
        try {
          const uploadRes = await fetch('/api/upload-previous-output', {
            method: 'POST',
            body: formData
          });
          const uploadData = await uploadRes.json();
          if (uploadData.success) {
            addLog(`[Output Loaded] ${uploadData.message}`, 'success');
          }
        } catch (e) {
          addLog(`[Warning] Could not upload custom output file: ${e.message}`, 'error');
        } finally {
          btnChoiceResume.disabled = false;
        }
      }

      await executeStartScraping(concurrency, true);
    });
  }

  // Modal Fresh Choice Click
  if (btnChoiceFresh) {
    btnChoiceFresh.addEventListener('click', async () => {
      closeResumeModal();
      const concurrency = concurrencyInput.value || 5;
      await executeStartScraping(concurrency, false);
    });
  }

  // Pause / Resume Scraper
  if (btnPause) {
    btnPause.addEventListener('click', async () => {
      try {
        const data = await safeFetchJson('/api/pause', { method: 'POST' });
        if (data.success) {
          updateStatusBadge(data.isPaused ? 'paused' : 'running');
        } else {
          addLog(`[Error] Pause failed: ${data.error}`, 'error');
        }
      } catch (err) {
        addLog(`[Error] Pause request failed: ${err.message}`, 'error');
      }
    });
  }

  // Live Concurrency Input Change
  if (concurrencyInput) {
    concurrencyInput.addEventListener('change', async () => {
      const val = parseInt(concurrencyInput.value, 10);
      if (!val || val < 1) return;

      try {
        const data = await safeFetchJson('/api/concurrency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concurrency: val })
        });
        if (!data.success) {
          addLog(`[Error] Concurrency update failed: ${data.error}`, 'error');
        }
      } catch (err) {
        console.error('Concurrency update error:', err);
      }
    });
  }

  // Stop Scraper
  btnStop.addEventListener('click', async () => {
    btnStop.disabled = true;
    if (btnPause) btnPause.disabled = true;
    addLog('[System] Sending stop signal to scraper workers...', 'info');

    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog(`[System] ${data.message}`, 'info');
        updateStatusBadge('idle');
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

  // Modal Elements
  const confirmModal = document.getElementById('confirmModal');
  const modalBtnCancel = document.getElementById('modalBtnCancel');
  const modalBtnConfirm = document.getElementById('modalBtnConfirm');
  const btnResetOutput = document.getElementById('btnResetOutput');

  // Export Modal Elements
  const btnDownloadOutput = document.getElementById('btnDownloadOutput');
  const btnDownloadFailed = document.getElementById('btnDownloadFailed');
  const exportModal = document.getElementById('exportModal');
  const exportFilename = document.getElementById('exportFilename');
  const exportFormat = document.getElementById('exportFormat');
  const exportTarget = document.getElementById('exportTarget');
  const exportBtnCancel = document.getElementById('exportBtnCancel');
  const exportBtnConfirm = document.getElementById('exportBtnConfirm');

  function openExportModal(target) {
    if (exportTarget) exportTarget.value = target;
    if (exportFilename) {
      exportFilename.value = target === 'failed' ? 'healow_failed_urls' : 'healow_scraped_output';
    }
    if (exportModal) exportModal.classList.add('active');
  }

  function closeExportModal() {
    if (exportModal) exportModal.classList.remove('active');
  }

  if (btnDownloadOutput) {
    btnDownloadOutput.addEventListener('click', () => openExportModal('output'));
  }

  if (btnDownloadFailed) {
    btnDownloadFailed.addEventListener('click', () => openExportModal('failed'));
  }

  if (exportBtnCancel) {
    exportBtnCancel.addEventListener('click', closeExportModal);
  }

  if (exportModal) {
    exportModal.addEventListener('click', (e) => {
      if (e.target === exportModal) closeExportModal();
    });
  }

  if (exportBtnConfirm) {
    exportBtnConfirm.addEventListener('click', () => {
      const target = exportTarget ? exportTarget.value : 'output';
      const filename = exportFilename ? exportFilename.value.trim() : 'healow_results';
      const format = exportFormat ? exportFormat.value : 'csv';

      closeExportModal();

      const downloadUrl = `/api/export?target=${encodeURIComponent(target)}&filename=${encodeURIComponent(filename)}&format=${encodeURIComponent(format)}`;
      addLog(`[Export] Downloading ${filename}.${format} ...`, 'success');
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${filename}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  function openModal() {
    if (confirmModal) confirmModal.classList.add('active');
  }

  function closeModal() {
    if (confirmModal) confirmModal.classList.remove('active');
  }

  if (modalBtnCancel) {
    modalBtnCancel.addEventListener('click', closeModal);
  }

  if (confirmModal) {
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) closeModal();
    });
  }

  // Reset Output CSV
  if (btnResetOutput) {
    btnResetOutput.addEventListener('click', () => {
      openModal();
    });
  }

  if (modalBtnConfirm) {
    modalBtnConfirm.addEventListener('click', async () => {
      closeModal();
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
      if (btnPauseText) btnPauseText.textContent = 'Pause';
      if (btnPause) btnPause.disabled = false;
    } else if (status === 'paused') {
      statusBadge.classList.add('paused');
      statusBadge.textContent = 'Paused';
      if (btnPauseText) btnPauseText.textContent = 'Resume';
      if (btnPause) btnPause.disabled = false;
    } else if (status === 'stopped') {
      statusBadge.classList.add('stopped');
      statusBadge.textContent = 'Stopped';
      if (btnPause) btnPause.disabled = true;
    } else if (status === 'completed') {
      statusBadge.classList.add('completed');
      statusBadge.textContent = 'Completed';
      if (btnPause) btnPause.disabled = true;
    } else {
      statusBadge.textContent = 'Idle';
      if (btnPause) btnPause.disabled = true;
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
