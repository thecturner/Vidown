// service_worker.js - Lean header-based detection

// In-memory stores
const netVideos = new Map();      // url -> { size, type, tabId }
const blobVideos = [];            // { size, type, ts }
const byTab = new Map();          // tabId -> { armed: bool }
const DL = new Map();             // downloadId -> job state

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
    job.expectedTotalBytes = job.expectedTotalBytes ?? delta.totalBytes.current;
  }

  if (delta.bytesReceived) {
    job.bytesReceived = delta.bytesReceived.current;

    // Compute percent with fallback
    const total = job.expectedTotalBytes || delta.totalBytes?.current || 0;
    job.percent = fmtPercent(job.bytesReceived, total) ?? null;

    updateSpeedAndEta(job, job.bytesReceived);

    chrome.runtime.sendMessage({
      type: "VIDOWN_DOWNLOAD_PROGRESS",
      job: {
        downloadId: id,
        bytesReceived: job.bytesReceived,
        expectedTotalBytes: total || null,
        percent: job.percent,
        speedBytesPerSec: job.speedBytesPerSec,
        etaSeconds: job.etaSeconds,
        state: "in_progress"
      }
    }).catch(() => {});
  }

  if (delta.state && delta.state.current) {
    const st = delta.state.current;
    if (st === "complete" || st === "interrupted") {
      job.state = st;
      chrome.runtime.sendMessage({
        type: "VIDOWN_DOWNLOAD_DONE",
        job: { downloadId: id, state: st, filename: job.filename, url: job.url }
      }).catch(() => {});
      // Keep a short while then free memory
      setTimeout(() => DL.delete(id), 30000);
    }
  }
});

// Messages from content scripts and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'VIDOWN_START_DOWNLOAD') {
    const { url, filename, expectedTotalBytes } = msg;

    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId == null) return;

      DL.set(downloadId, {
        downloadId,
        url,
        filename,
        expectedTotalBytes: Number.isFinite(expectedTotalBytes) ? expectedTotalBytes : null,
        bytesReceived: 0,
        percent: 0,
        speedBytesPerSec: 0,
        etaSeconds: null,
        state: "in_progress",
        lastTick: nowMs()
      });

      chrome.runtime.sendMessage({
        type: "VIDOWN_DOWNLOAD_STARTED",
        job: { downloadId, url, filename, expectedTotalBytes }
      }).catch(() => {});
    });

    return;
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
    return;
  }
});

// HLS check helper
function isLikelyHLS(url, type) {
  return /\.m3u8($|\?)/i.test(url) ||
         (type && /application\/(vnd\.apple\.mpegurl|x-mpegURL)/i.test(type));
}
