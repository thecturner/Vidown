// content_script.js

// Inject lightweight blob interceptor (runs immediately, minimal overhead)
(function injectBlobInterceptor() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    // Silently fail if injection doesn't work
  }
})();

// Listen for blob notifications (async, doesn't block page)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'VIDOWN_BLOB_CREATED') {
    chrome.runtime.sendMessage({
      action: 'BLOB_VIDEO_DETECTED',
      data: msg.data
    }).catch(() => {}); // Ignore errors
  } else if (msg.type === 'VIDOWN_BLOB_REVOKED') {
    chrome.runtime.sendMessage({
      action: 'BLOB_VIDEO_REVOKED',
      data: msg.data
    }).catch(() => {});
  }
});

// Extract video title from various sources
function getVideoTitle(videoElement) {
  // Try to get title from video element attributes
  if (videoElement.title) return videoElement.title;
  if (videoElement.getAttribute('aria-label')) return videoElement.getAttribute('aria-label');

  // Try to find title from nearby elements
  const container = videoElement.closest('[data-title]') ||
                   videoElement.closest('article') ||
                   videoElement.closest('[class*="video"]');

  if (container) {
    const dataTitle = container.getAttribute('data-title');
    if (dataTitle) return dataTitle;

    // Look for heading elements nearby
    const heading = container.querySelector('h1, h2, h3, h4');
    if (heading && heading.textContent.trim()) {
      return heading.textContent.trim();
    }
  }

  // Try to get from page title
  const pageTitle = document.title;
  if (pageTitle && !pageTitle.toLowerCase().includes('youtube') && !pageTitle.toLowerCase().includes('video')) {
    // If page title is meaningful, use it
    return pageTitle;
  }

  // Try meta tags
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) return ogTitle.getAttribute('content');

  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) return twitterTitle.getAttribute('content');

  return null;
}

// Format duration to readable string
function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return null;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Build list of visible HTMLMediaElement objects and basic info
function listVideos() {
  const vids = Array.from(document.querySelectorAll("video"));
  const out = vids.map((v, idx) => {
    // try to get the current source URL. currentSrc often resolves to the effective URL.
    const currentSrc = v.currentSrc || v.src || (v.querySelector && (v.querySelector("source") && v.querySelector("source").src)) || "";
    const srcs = Array.from((v.querySelectorAll("source") || [])).map(s => s.src).filter(Boolean);

    const title = getVideoTitle(v);
    const duration = isFinite(v.duration) ? v.duration : null;
    const formattedDuration = formatDuration(duration);

    return {
      index: idx,
      width: v.videoWidth,
      height: v.videoHeight,
      duration: duration,
      formattedDuration: formattedDuration,
      title: title,
      currentSrc: currentSrc,
      allSources: Array.from(new Set([currentSrc, ...srcs])).filter(Boolean)
    };
  }).filter(v => {
    // Only include videos with valid dimensions and duration, and at least one source
    return v.width > 0 &&
           v.height > 0 &&
           v.duration > 0 &&
           v.allSources.length > 0;
  });
  return out;
}

// Message handler for extension requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  if (msg.action === "LIST_VIDEOS" || msg.action === "GET_VIDEO_SOURCES") {
    const list = listVideos();
    sendResponse({ ok: true, list });
    return true;
  }

  // fallback
  sendResponse({ ok: false, error: "unknown action" });
  return true;
});
