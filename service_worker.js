// service_worker.js - Queue manager and stream downloader

// In-memory stores
const netVideos = new Map();      // url -> { size, type, tabId }
const blobVideos = [];            // { size, type, ts }
const byTab = new Map();          // tabId -> { armed: bool }
const DL = new Map();             // downloadId -> job state

// Queue management
const jobQueue = [];              // Array of pending jobs
const activeJobs = new Map();     // jobId -> job state
const MAX_CONCURRENT = 2;
let jobIdCounter = 0;

// Native messaging port
let nativePort = null;

// Download tracking helpers
function nowMs() { return Date.now(); }

function fmtPercent(bytes, total) {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((bytes / total) * 100)));
}

// Exponential moving average for speed smoothing
function updateSpeedAndEta(job, bytesReceived) {
  const t = nowMs();
  const dt = (t - (job.lastTick || t)) / 1000; // seconds
  const dBytes = bytesReceived - (job.bytesReceived || 0);

  let inst = dt > 0 ? dBytes / dt : 0;
  if (!Number.isFinite(inst) || inst < 0) inst = 0;

  const alpha = 0.25;
  job.speedBytesPerSec = job.speedBytesPerSec == null
    ? inst
    : (alpha * inst + (1 - alpha) * job.speedBytesPerSec);

  const remaining = (job.expectedTotalBytes || 0) > 0
    ? Math.max(0, job.expectedTotalBytes - bytesReceived)
    : null;

  job.etaSeconds = remaining != null && job.speedBytesPerSec > 0
    ? Math.ceil(remaining / job.speedBytesPerSec)
    : null;

  job.lastTick = t;
}

// ===== Queue Manager =====

function generateJobId() {
  return `job-${Date.now()}-${++jobIdCounter}`;
}

function enqueueJob(item, options = {}) {
  const jobId = generateJobId();
  const job = {
    id: jobId,
    state: 'queued',
    url: item.url,
    mode: item.mode || detectMode(item.url),
    size: item.size || null,
    headers: item.headers || {},
    quality: item.quality || '',
    filenameHint: item.filenameHint || '',
    convert: options.convert || null,
    mergeAV: options.mergeAV || false,
    muxSubtitles: options.muxSubtitles || false,
    retries: 0,
    maxRetries: 3,
    bytesReceived: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    percent: 0,
    error: null,
    createdAt: nowMs(),
    lastTick: nowMs()
  };

  jobQueue.push(job);
  broadcastJobUpdate('JOB_ADDED', job);
  processQueue();
  return jobId;
}

function detectMode(url) {
  if (/\.m3u8($|\?)/i.test(url)) return 'hls';
  if (/\.mpd($|\?)/i.test(url)) return 'dash';
  if (url.startsWith('blob:')) return 'blob';
  return 'http';
}

function processQueue() {
  // Start jobs up to MAX_CONCURRENT
  while (activeJobs.size < MAX_CONCURRENT && jobQueue.length > 0) {
    const job = jobQueue.shift();
    startJob(job);
  }
}

function startJob(job) {
  job.state = 'active';
  activeJobs.set(job.id, job);
  broadcastJobUpdate('JOB_PROGRESS', job);

  if (job.mode === 'http' && !job.headers.Cookie && !job.convert) {
    // Simple HTTP download via chrome.downloads
    startChromeDownload(job);
  } else {
    // Complex download - delegate to native app
    startNativeDownload(job);
  }
}

function startChromeDownload(job) {
  const filename = job.filenameHint || getFilenameFromUrl(job.url);

  chrome.downloads.download({ url: job.url, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) {
      handleJobError(job, chrome.runtime.lastError.message);
      return;
    }

    job.downloadId = downloadId;
    DL.set(downloadId, job);
  });
}

function startNativeDownload(job) {
  if (!nativePort) {
    connectNative();
  }

  if (!nativePort) {
    handleJobError(job, 'Native companion app not available');
    return;
  }

  const msg = {
    cmd: 'download',
    id: job.id,
    mode: job.mode,
    url: job.url,
    headers: job.headers,
    convert: job.convert,
    mergeAV: job.mergeAV,
    muxSubtitles: job.muxSubtitles
  };

  try {
    nativePort.postMessage(msg);
  } catch (err) {
    handleJobError(job, `Native messaging error: ${err.message}`);
  }
}

function connectNative() {
  try {
    nativePort = chrome.runtime.connectNative('com.vidown.native');

    nativePort.onMessage.addListener((msg) => {
      handleNativeMessage(msg);
    });

    nativePort.onDisconnect.addListener(() => {
      console.error('[Vidown] Native disconnected:', chrome.runtime.lastError);
      nativePort = null;
    });
  } catch (err) {
    console.error('[Vidown] Cannot connect to native app:', err);
    nativePort = null;
  }
}

function handleNativeMessage(msg) {
  if (!msg.id) return;

  const job = activeJobs.get(msg.id);
  if (!job) return;

  if (msg.event === 'progress') {
    job.bytesReceived = msg.bytesReceived || 0;
    job.speedBytesPerSec = msg.speedBps || 0;
    job.etaSeconds = msg.etaSec || null;
    job.percent = job.size ? fmtPercent(job.bytesReceived, job.size) : null;
    broadcastJobUpdate('JOB_PROGRESS', job);
  } else if (msg.event === 'done') {
    completeJob(job, msg.path);
  } else if (msg.event === 'error') {
    handleJobError(job, msg.error);
  }
}

function completeJob(job, path = null) {
  job.state = 'complete';
  job.percent = 100;
  job.path = path;
  activeJobs.delete(job.id);
  broadcastJobUpdate('JOB_DONE', job);
  processQueue();
}

function handleJobError(job, error) {
  console.error(`[Vidown] Job ${job.id} error:`, error);

  job.retries++;
  if (job.retries < job.maxRetries) {
    // Retry with exponential backoff
    const delay = Math.min(1000 * Math.pow(2, job.retries), 30000);
    job.state = 'retrying';
    job.error = `${error} (retry ${job.retries}/${job.maxRetries})`;
    broadcastJobUpdate('JOB_PROGRESS', job);

    setTimeout(() => {
      activeJobs.delete(job.id);
      jobQueue.unshift(job); // Put back at front
      processQueue();
    }, delay);
  } else {
    job.state = 'error';
    job.error = error;
    activeJobs.delete(job.id);
    broadcastJobUpdate('JOB_ERROR', job);
    processQueue();
  }
}

function pauseJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.state = 'paused';
  if (job.downloadId) {
    chrome.downloads.pause(job.downloadId);
  }
  // TODO: Send pause to native app
  broadcastJobUpdate('JOB_PROGRESS', job);
}

function resumeJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.state = 'active';
  if (job.downloadId) {
    chrome.downloads.resume(job.downloadId);
  }
  // TODO: Send resume to native app
  broadcastJobUpdate('JOB_PROGRESS', job);
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) {
    // Check if queued
    const idx = jobQueue.findIndex(j => j.id === jobId);
    if (idx >= 0) {
      const removed = jobQueue.splice(idx, 1)[0];
      removed.state = 'cancelled';
      broadcastJobUpdate('JOB_ERROR', removed);
    }
    return;
  }

  if (job.downloadId) {
    chrome.downloads.cancel(job.downloadId);
  }

  // TODO: Send cancel to native app

  job.state = 'cancelled';
  activeJobs.delete(jobId);
  broadcastJobUpdate('JOB_ERROR', job);
  processQueue();
}

function broadcastJobUpdate(type, job) {
  const msg = {
    type,
    job: {
      id: job.id,
      state: job.state,
      filename: job.filenameHint,
      percent: job.percent,
      speedBytesPerSec: job.speedBytesPerSec,
      etaSeconds: job.etaSeconds,
      bytesReceived: job.bytesReceived,
      size: job.size,
      error: job.error,
      path: job.path
    }
  };

  chrome.runtime.sendMessage(msg).catch(() => {});
}

function getFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    if (filename && filename.includes('.')) {
      return filename.split('?')[0];
    }
  } catch (_) {}
  return `video-${Date.now()}.mp4`;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Vidown installed');
});

// Observe response headers for media only
chrome.webRequest.onHeadersReceived.addListener(
  details => {
    try {
      const ct = header(details.responseHeaders, 'content-type');
      const cl = header(details.responseHeaders, 'content-length');
      const isMedia = details.type === 'media' ||
                      (ct && ct.startsWith('video/')) ||
                      /\.(mp4|webm|mov|avi|mkv|m4v|flv)($|\?)/i.test(details.url);

      if (isMedia) {
        const size = cl ? parseInt(cl, 10) : undefined;
        netVideos.set(details.url, {
          size,
          type: ct || null,
          tabId: details.tabId
        });

        // Update badge for this tab
        updateBadge(details.tabId);
      }
    } catch (_) { /* swallow */ }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Helper to read header ignoring case
function header(headers, name) {
  const h = headers?.find(h => h.name?.toLowerCase() === name);
  return h?.value || null;
}

// Update badge count
function updateBadge(tabId) {
  if (tabId < 0) return;

  const count = Array.from(netVideos.values())
    .filter(v => v.tabId === tabId)
    .length + blobVideos.length;

  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString(), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
  }
}

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  byTab.delete(tabId);
  // Remove videos for this tab
  for (const [url, video] of netVideos.entries()) {
    if (video.tabId === tabId) {
      netVideos.delete(url);
    }
  }
});

// Clean up on navigation
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    byTab.delete(details.tabId);
    // Clear videos for this tab
    for (const [url, video] of netVideos.entries()) {
      if (video.tabId === details.tabId) {
        netVideos.delete(url);
      }
    }
    chrome.action.setBadgeText({ text: "", tabId: details.tabId });
  }
});

// Download progress tracking
chrome.downloads.onChanged.addListener(delta => {
  const id = delta.id;
  const job = DL.get(id);
  if (!job) return;

  if (delta.totalBytes && delta.totalBytes.current > 0) {
    job.size = job.size ?? delta.totalBytes.current;
  }

  if (delta.bytesReceived) {
    job.bytesReceived = delta.bytesReceived.current;

    // Compute percent with fallback
    const total = job.size || delta.totalBytes?.current || 0;
    job.percent = fmtPercent(job.bytesReceived, total) ?? 0;

    updateSpeedAndEta(job, job.bytesReceived);

    broadcastJobUpdate('JOB_PROGRESS', job);
  }

  if (delta.state && delta.state.current) {
    const st = delta.state.current;
    if (st === "complete") {
      completeJob(job);
      DL.delete(id);
    } else if (st === "interrupted") {
      handleJobError(job, 'Download interrupted');
      DL.delete(id);
    }
  }
});

// Messages from content scripts and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // New queue-based download
  if (msg?.type === 'VIDOWN_ENQUEUE') {
    const jobId = enqueueJob(msg.item, msg.options);
    sendResponse({ success: true, jobId });
    return true;
  }

  // Job control
  if (msg?.type === 'VIDOWN_PAUSE_JOB') {
    pauseJob(msg.jobId);
    sendResponse({ success: true });
    return true;
  }

  if (msg?.type === 'VIDOWN_RESUME_JOB') {
    resumeJob(msg.jobId);
    sendResponse({ success: true });
    return true;
  }

  if (msg?.type === 'VIDOWN_CANCEL_JOB') {
    cancelJob(msg.jobId);
    sendResponse({ success: true });
    return true;
  }

  if (msg?.type === 'VIDOWN_GET_QUEUE') {
    const allJobs = [
      ...Array.from(activeJobs.values()),
      ...jobQueue
    ].map(j => ({
      id: j.id,
      state: j.state,
      filename: j.filenameHint,
      percent: j.percent,
      speedBytesPerSec: j.speedBytesPerSec,
      etaSeconds: j.etaSeconds,
      error: j.error
    }));
    sendResponse({ jobs: allJobs });
    return true;
  }

  // Legacy direct download (kept for backward compatibility)
  if (msg?.type === 'VIDOWN_START_DOWNLOAD') {
    const jobId = enqueueJob({
      url: msg.url,
      filenameHint: msg.filename,
      size: msg.expectedTotalBytes
    });
    sendResponse({ success: true, jobId });
    return true;
  }

  if (msg?.type === 'BLOB_META') {
    // Keep last few only to minimize memory
    if (msg.meta?.size >= 524288) {
      blobVideos.push({
        size: msg.meta.size,
        type: msg.meta.type,
        ts: Date.now(),
        tabId: sender.tab?.id
      });
      if (blobVideos.length > 50) blobVideos.shift();

      // Update badge for the tab
      if (sender.tab?.id) {
        updateBadge(sender.tab.id);
      }
    }
    return;
  }

  if (msg?.type === 'POPUP_OPENED') {
    const tabId = sender?.tab?.id || msg.tabId;
    if (tabId != null) {
      // Arm once per tab
      if (!byTab.get(tabId)?.armed) {
        byTab.set(tabId, { armed: true });
        chrome.tabs.sendMessage(tabId, { type: 'VIDOWN_ARM' }).catch(() => {});
      }
      // Ask for a single DOM scan
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_DOM_VIDEOS' }).catch(() => {});
      }, 100);
    }
    return;
  }

  if (msg?.type === 'REQUEST_STATE') {
    const tabId = msg.tabId;
    // Return a compact snapshot to popup
    const netForTab = Array.from(netVideos.entries())
      .filter(([_, v]) => v.tabId === tabId)
      .slice(-50)
      .map(([url, v]) => ({ url, ...v }));

    const blobsForTab = blobVideos
      .filter(b => b.tabId === tabId)
      .slice(-50);

    sendResponse({
      type: 'STATE',
      net: netForTab,
      blobs: blobsForTab
    });
    return true; // Indicate synchronous response sent
  }
});

// HLS check helper
function isLikelyHLS(url, type) {
  return /\.m3u8($|\?)/i.test(url) ||
         (type && /application\/(vnd\.apple\.mpegurl|x-mpegURL)/i.test(type));
}
