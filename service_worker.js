// service_worker.js - Lean header-based detection

// In-memory stores
const netVideos = new Map();      // url -> { size, type, tabId }
const blobVideos = [];            // { size, type, ts }
const byTab = new Map();          // tabId -> { armed: bool }

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

// Messages from content scripts and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
