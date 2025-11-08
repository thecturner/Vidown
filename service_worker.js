// service_worker.js

// Store detected video URLs and metadata from network requests
const detectedVideos = new Map(); // tabId -> Array of {url, title, size}
const pageMetadata = new Map(); // tabId -> {title, duration}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Vidown extension installed.");
});

// Monitor network requests for video files
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const tabId = details.tabId;

    // Skip if no valid tab
    if (tabId < 0) return;

    // Detect common video formats and streaming protocols
    if (isVideoUrl(url)) {
      if (!detectedVideos.has(tabId)) {
        detectedVideos.set(tabId, []);
      }

      const videos = detectedVideos.get(tabId);

      // Check if URL already exists
      if (!videos.find(v => v.url === url)) {
        videos.push({
          url: url,
          title: null, // Will be populated from page metadata
          size: null
        });

        // Update badge to show video count
        updateBadge(tabId);
      }
    }
  },
  { urls: ["<all_urls>"] }
);

// Listen for response headers to capture Content-Length
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;

    const videos = detectedVideos.get(tabId);
    if (!videos) return;

    const video = videos.find(v => v.url === details.url);
    if (video) {
      // Extract Content-Length from headers
      const contentLength = details.responseHeaders?.find(
        h => h.name.toLowerCase() === 'content-length'
      );
      if (contentLength && contentLength.value) {
        video.size = parseInt(contentLength.value, 10);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedVideos.delete(tabId);
});

// Clean up when navigating to new page
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    detectedVideos.delete(details.tabId);
    chrome.action.setBadgeText({ text: "", tabId: details.tabId });
  }
});

function isVideoUrl(url) {
  const lower = url.toLowerCase();

  // Filter out TS segment files (streaming chunks)
  // TS files are typically named like: segment0.ts, chunk_123.ts, 0001.ts
  if (/\/[\w-]*\d+\.ts(\?|$)/i.test(lower)) {
    return false; // These are HLS segments, not complete videos
  }

  // Common video file extensions (excluding .ts)
  if (/\.(mp4|webm|ogg|ogv|mov|avi|wmv|flv|mkv|m4v|3gp)(\?|$)/i.test(lower)) {
    return true;
  }

  // Streaming protocols (M3U8 playlists and DASH manifests)
  if (lower.includes('.m3u8') || lower.includes('.mpd')) {
    return true;
  }

  // Common video MIME types in URL
  if (lower.includes('video/') || lower.includes('application/x-mpegurl')) {
    return true;
  }

  return false;
}

function updateBadge(tabId) {
  const count = detectedVideos.get(tabId)?.length || 0;
  if (count > 0) {
    chrome.action.setBadgeText({
      text: count.toString(),
      tabId: tabId
    });
    chrome.action.setBadgeBackgroundColor({
      color: "#4CAF50",
      tabId: tabId
    });
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "GET_NETWORK_VIDEOS") {
    const tabId = msg.tabId;
    const videos = detectedVideos.get(tabId) || [];

    // Try to get page metadata and enrich video data
    chrome.tabs.get(tabId, (tab) => {
      const pageTitle = tab.title || 'Unknown';

      // Enrich videos with page title if they don't have one
      const enrichedVideos = videos.map((v, idx) => ({
        ...v,
        title: v.title || pageTitle,
        index: idx
      }));

      sendResponse({ ok: true, videos: enrichedVideos });
    });

    return true; // Keep message channel open for async response
  }

  if (msg.action === "UPDATE_VIDEO_METADATA") {
    const tabId = msg.tabId;
    const metadata = msg.metadata;

    if (pageMetadata.has(tabId)) {
      pageMetadata.set(tabId, { ...pageMetadata.get(tabId), ...metadata });
    } else {
      pageMetadata.set(tabId, metadata);
    }

    return true;
  }

  // Handle blob URL detection from content script
  if (msg.action === "BLOB_VIDEO_DETECTED") {
    const tabId = sender.tab?.id;
    if (!tabId || tabId < 0) return true;

    const blobData = msg.data;

    if (!detectedVideos.has(tabId)) {
      detectedVideos.set(tabId, []);
    }

    const videos = detectedVideos.get(tabId);

    // Check if blob URL already exists
    if (!videos.find(v => v.url === blobData.url)) {
      videos.push({
        url: blobData.url,
        title: `Blob Video (${blobData.type || 'unknown'})`,
        size: blobData.size,
        isBlob: true
      });

      // Update badge
      updateBadge(tabId);
    }

    return true;
  }

  // Handle blob URL revocation
  if (msg.action === "BLOB_VIDEO_REVOKED") {
    const tabId = sender.tab?.id;
    if (!tabId || tabId < 0) return true;

    const videos = detectedVideos.get(tabId);
    if (videos) {
      const index = videos.findIndex(v => v.url === msg.data.url);
      if (index !== -1) {
        videos.splice(index, 1);
        updateBadge(tabId);
      }
    }

    return true;
  }

  return true;
});
