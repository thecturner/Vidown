// popup.js

// Track downloaded videos
const downloadedVideos = new Set();

// Cache for video sizes
const videoSizeCache = new Map();

// Load downloaded videos from storage
async function loadDownloadedVideos() {
  const result = await chrome.storage.local.get(['downloadedVideos']);
  if (result.downloadedVideos) {
    result.downloadedVideos.forEach(url => downloadedVideos.add(url));
  }
}

// Save downloaded video to storage
async function markAsDownloaded(url) {
  downloadedVideos.add(url);
  await chrome.storage.local.set({
    downloadedVideos: Array.from(downloadedVideos)
  });
}

// Check if video is downloaded
function isDownloaded(url) {
  return downloadedVideos.has(url);
}

// Fetch video size using HEAD request (only for non-blob URLs when needed)
async function fetchVideoSize(url) {
  // Don't fetch blob URLs - size should come from interceptor
  if (url.startsWith('blob:')) {
    return null;
  }

  // Check cache first
  if (videoSizeCache.has(url)) {
    return videoSizeCache.get(url);
  }

  try {
    // For regular URLs, use HEAD request only
    const response = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
    const contentLength = response.headers.get('content-length');
    const size = contentLength ? parseInt(contentLength, 10) : null;

    // Cache the result
    if (size) {
      videoSizeCache.set(url, size);
    }

    return size;
  } catch (err) {
    // Fail silently - size isn't critical
    return null;
  }
}

// Load download history from storage
async function loadDownloadHistory() {
  const result = await chrome.storage.local.get(['downloadHistory']);
  return result.downloadHistory || [];
}

// Save download to history
async function saveToHistory(url, filename, size, location = null) {
  const history = await loadDownloadHistory();
  const settings = await loadSettings();

  const entry = {
    url,
    filename,
    size,
    location: location || settings.downloadPath || 'Downloads',
    timestamp: Date.now()
  };

  // Add to beginning of array
  history.unshift(entry);

  // Limit history size based on settings
  const limit = settings.historyLimit || 50;
  const trimmedHistory = history.slice(0, limit);

  await chrome.storage.local.set({ downloadHistory: trimmedHistory });
}

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return result.settings || {
    downloadPath: '',
    askLocation: false,
    autoConvert: true,
    showBadge: true,
    historyLimit: 50
  };
}

function setStatus(s) {
  document.getElementById("status").textContent = s;
}

function setProgress(s) {
  const el = document.getElementById("progress");
  el.textContent = s;
  el.style.display = s ? "block" : "none";
}

function showDownloadProgress(show = true) {
  const el = document.getElementById("download-progress");
  if (show) {
    el.classList.add("active");
  } else {
    el.classList.remove("active");
  }
}

function updateDownloadProgress(title, loaded, total, speed = null) {
  document.getElementById("progress-title").textContent = title;

  const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
  document.getElementById("progress-percent").textContent = `${percent}%`;
  document.getElementById("progress-bar-fill").style.width = `${percent}%`;

  const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
  const totalMB = (total / (1024 * 1024)).toFixed(1);
  document.getElementById("progress-size").textContent = `${loadedMB} MB / ${totalMB} MB`;

  if (speed !== null) {
    const speedMB = (speed / (1024 * 1024)).toFixed(2);
    document.getElementById("progress-speed").textContent = `${speedMB} MB/s`;
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getVideoFormat(url) {
  // Handle blob URLs
  if (url.startsWith('blob:')) {
    return 'Video';
  }

  const ext = url.split('.').pop().split('?')[0].toLowerCase();
  const formats = {
    'mp4': 'MP4',
    'webm': 'WebM',
    'mov': 'MOV',
    'avi': 'AVI',
    'mkv': 'MKV',
    'flv': 'FLV',
    'm3u8': 'HLS Stream',
    'mpd': 'DASH Stream',
    'm4v': 'M4V',
    'ogg': 'OGG',
    'ogv': 'OGV'
  };
  return formats[ext] || ext.toUpperCase();
}

function isStreamingFormat(url) {
  const lower = url.toLowerCase();
  return lower.includes('.m3u8') || lower.includes('.mpd');
}

async function queryVideosInTab(tab) {
  // Get network-detected videos from background service worker
  const networkVideos = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "GET_NETWORK_VIDEOS", tabId: tab.id },
      (resp) => resolve(resp?.videos || [])
    );
  });

  // Get DOM-based videos from content script with timeout
  // (content script is auto-injected at document_start)
  const domVideos = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log("Content script timeout, using network videos only");
      resolve([]);
    }, 2000);

    chrome.tabs.sendMessage(tab.id, { action: "LIST_VIDEOS" }, (resp) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        console.log("Content script error:", chrome.runtime.lastError);
        resolve([]);
      } else {
        resolve(resp?.ok ? resp.list : []);
      }
    });
  });

  return {
    tab,
    domVideos,
    networkVideos,
    totalVideos: domVideos.length + networkVideos.length
  };
}

async function queryVideosInActiveTab() {
  setStatus("Detecting videos...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus("No active tab.");
    return;
  }

  const result = await queryVideosInTab(tab);
  await renderList(result.domVideos, result.networkVideos, result.tab.id);
}

async function queryVideosInAllTabs() {
  setStatus("Scanning all tabs...");
  const tabs = await chrome.tabs.query({ currentWindow: true });

  const results = [];
  for (const tab of tabs) {
    const result = await queryVideosInTab(tab);
    if (result.totalVideos > 0) {
      results.push(result);
    }
  }

  await renderAllTabsResults(results);
}

async function renderList(domVideos, networkVideos, tabId) {
  const container = document.getElementById("list");
  container.innerHTML = "";

  const totalVideos = domVideos.length + networkVideos.length;
  if (totalVideos === 0) {
    setStatus("No videos detected");
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
        </svg>
        <p>No videos found on this page</p>
      </div>
    `;
    return;
  }

  setStatus(`Found ${totalVideos} video${totalVideos > 1 ? 's' : ''}`);

  // Render network-detected videos first
  if (networkVideos.length > 0) {
    const section = document.createElement("div");
    section.className = "section-title";
    section.textContent = `Network Videos (${networkVideos.length})`;
    container.appendChild(section);

    networkVideos.forEach((video, idx) => {
      const div = document.createElement("div");
      const url = video.url || video; // Handle both object and string formats
      const downloaded = isDownloaded(url);

      div.className = downloaded ? "video-item downloaded" : "video-item";

      const title = video.title || `Network Video ${idx + 1}`;
      const format = getVideoFormat(url);
      const size = video.size ? formatFileSize(video.size) : null;

      // Truncate title if too long
      const displayTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;

      // Build metadata line
      let metaHtml = '';
      if (size) {
        metaHtml = `<div class="video-meta">📦 ${size}</div>`;
      }

      // Check if it's a streaming format
      const isStreaming = isStreamingFormat(url);
      const sizeText = size || '';
      const downloadText = isStreaming ? '⚠️ Stream Playlist' :
                          downloaded ? `Downloaded (${format})` :
                          sizeText ? `⬇ ${sizeText} • ${format}` : `⬇ ${format}`;
      const noteHtml = isStreaming ? '<div style="font-size: 10px; color: #f39c12; margin-top: 4px;">⚠️ Requires HLS downloader tool</div>' : '';
      const downloadedBadge = downloaded ? '<div class="downloaded-badge">Downloaded</div>' : '';
      const buttonClass = downloaded ? "download-network downloaded" : "download-network";

      div.innerHTML = `
        ${downloadedBadge}
        <div class="video-header">
          <div class="video-title" title="${title}">${displayTitle}</div>
          <div class="video-badge">${format}</div>
        </div>
        ${metaHtml}
        <div class="video-url" title="${url}">${url}</div>
        ${noteHtml}
        <div class="button-group">
          <button data-url="${encodeURIComponent(url)}" data-title="${title}" class="${buttonClass}">${downloadText}</button>
        </div>
      `;
      container.appendChild(div);
    });
  }

  // Render DOM-based video elements
  if (domVideos.length > 0) {
    const section = document.createElement("div");
    section.className = "section-title";
    section.textContent = `Page Videos (${domVideos.length})`;
    container.appendChild(section);

    domVideos.forEach((v) => {
      const div = document.createElement("div");
      const downloaded = v.currentSrc && isDownloaded(v.currentSrc);
      div.className = downloaded ? "video-item downloaded" : "video-item";

      const format = v.currentSrc ? getVideoFormat(v.currentSrc) : 'Unknown';
      const title = v.title || `Video ${v.index + 1}`;
      const displayTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
      const duration = v.formattedDuration || 'Unknown';

      // Show all available sources
      let buttonsHtml = '';
      if (v.allSources && v.allSources.length > 0) {
        buttonsHtml = v.allSources.map((src, idx) => {
          const srcFormat = getVideoFormat(src);
          const srcDownloaded = isDownloaded(src);
          const btnClass = srcDownloaded ? "download-dom downloaded" : "download-dom";
          const btnText = srcDownloaded ? `Downloaded (${srcFormat})` : `⬇ ${srcFormat}`;
          return `<button data-idx="${v.index}" data-src-idx="${idx}" data-url="${encodeURIComponent(src)}" class="${btnClass}">${btnText}</button>`;
        }).join('');
      } else {
        buttonsHtml = '<button disabled>No source available</button>';
      }

      const downloadedBadge = downloaded ? '<div class="downloaded-badge">Downloaded</div>' : '';

      div.innerHTML = `
        ${downloadedBadge}
        <div class="video-header">
          <div class="video-title" title="${title}">${displayTitle}</div>
          <div class="video-badge">${format}</div>
        </div>
        <div class="video-meta with-duration">${v.width}×${v.height} • ${duration}</div>
        <div class="video-url" title="${v.currentSrc || 'No source'}">${v.currentSrc || '(no source)'}</div>
        <div class="button-group">
          ${buttonsHtml}
        </div>
      `;
      container.appendChild(div);
    });
  }

  // Add download listeners for network videos
  container.querySelectorAll(".download-network").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const url = decodeURIComponent(e.target.dataset.url);
      const title = e.target.dataset.title;
      downloadNetworkVideo(url, title);
    });
  });

  // Add download listeners for DOM videos
  container.querySelectorAll(".download-dom").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const srcIdx = parseInt(e.target.dataset.srcIdx, 10);
      downloadSource(tabId, idx, srcIdx);
    });
  });
}

function sanitizeFilename(filename) {
  // Remove invalid filename characters
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove invalid chars
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .substring(0, 200); // Limit length
}

function getDownloadFilename(url, title = null) {
  const format = getVideoFormat(url).toLowerCase();

  // If we have a title, use it
  if (title && title !== 'Unknown' && !title.startsWith('Network Video') && !title.startsWith('Video ')) {
    const sanitized = sanitizeFilename(title);
    // Add extension if title doesn't have one
    if (!sanitized.match(/\.\w{2,4}$/)) {
      return `${sanitized}.${format}`;
    }
    return sanitized;
  }

  // Try to extract filename from URL
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();

    // If we have a valid filename with extension, use it
    if (filename && filename.includes('.')) {
      return sanitizeFilename(filename.split('?')[0]);
    }
  } catch (e) {
    // Invalid URL, fall through
  }

  // Fallback: generate filename based on format
  return `video-${Date.now()}.${format}`;
}

async function downloadNetworkVideo(url, title) {
  await downloadVideoFromUrl(url, title);
}

async function downloadSource(tabId, videoIndex, sourceIndex) {
  setStatus("Fetching video source...");

  chrome.tabs.sendMessage(tabId, { action: "GET_VIDEO_SOURCES" }, async (resp) => {
    if (!resp || !resp.ok) {
      setStatus("Error fetching sources: " + (resp?.error || "unknown"));
      return;
    }

    const item = resp.list.find(x => x.index === videoIndex);
    if (!item || !item.allSources || !item.allSources[sourceIndex]) {
      setStatus("Video source not found.");
      return;
    }

    const url = item.allSources[sourceIndex];
    const title = item.title;
    await downloadVideoFromUrl(url, title);
  });
}

async function downloadVideoFromUrl(url, title = null) {
  setStatus("Downloading...");
  const filename = getDownloadFilename(url, title);
  const displayTitle = title || filename;

  try {
    // Try to fetch and download the video with progress tracking
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (total > 0) {
      // Show progress bar for downloads with known size
      showDownloadProgress(true);
      updateDownloadProgress(displayTitle, 0, total, 0);

      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      let startTime = Date.now();
      let lastTime = startTime;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        // Calculate speed
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000; // seconds
        const speed = elapsed > 0 ? value.length / elapsed : 0;

        // Update progress
        updateDownloadProgress(displayTitle, loaded, total, speed);
        lastTime = now;
      }

      // Combine chunks into blob
      const blob = new Blob(chunks);

      // Hide progress bar
      setTimeout(() => showDownloadProgress(false), 1000);

      // Create download link
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();

      // Clean up the object URL after a short delay
      setTimeout(() => URL.revokeObjectURL(link.href), 100);

      // Mark as downloaded
      await markAsDownloaded(url);

      // Save to download history
      const settings = await loadSettings();
      await saveToHistory(url, filename, blob.size, settings.downloadPath);

      setStatus(`✓ Downloaded (${formatFileSize(blob.size)})`);

      // Refresh history display
      await renderDownloadHistory();
    } else {
      // No content-length header, download without progress
      const blob = await response.blob();

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();

      setTimeout(() => URL.revokeObjectURL(link.href), 100);

      // Mark as downloaded
      await markAsDownloaded(url);

      // Save to download history
      const settings = await loadSettings();
      await saveToHistory(url, filename, blob.size, settings.downloadPath);

      setStatus(`✓ Downloaded (${formatFileSize(blob.size)})`);

      // Refresh history display
      await renderDownloadHistory();
    }
  } catch (err) {
    console.log("Direct download failed:", err);
    showDownloadProgress(false);

    // If fetch fails (CORS or other issues), try chrome.downloads API
    try {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          // Last resort: open in new tab
          chrome.tabs.create({ url });
          setStatus("⚠ Opened in new tab (download restricted)");
        } else {
          setStatus("✓ Download started");
        }
      });
    } catch (downloadErr) {
      // Final fallback: open in new tab
      chrome.tabs.create({ url });
      setStatus("⚠ Opened in new tab (download restricted)");
    }
  }
}

// Render download history
async function renderDownloadHistory() {
  const historyContainer = document.getElementById("history-list");
  if (!historyContainer) return;

  const history = await loadDownloadHistory();

  if (history.length === 0) {
    historyContainer.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #999; font-size: 13px;">
        No downloads yet
      </div>
    `;
    return;
  }

  historyContainer.innerHTML = '';

  history.forEach((entry, idx) => {
    const div = document.createElement("div");
    div.className = "history-item";

    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sizeStr = formatFileSize(entry.size);
    const filename = entry.filename.length > 40 ? entry.filename.substring(0, 40) + '...' : entry.filename;

    div.innerHTML = `
      <div class="history-header">
        <div class="history-filename" title="${entry.filename}">${filename}</div>
        <div class="history-date">${dateStr}</div>
      </div>
      <div class="history-meta">
        <span>📦 ${sizeStr}</span>
        <span>📁 ${entry.location}</span>
      </div>
    `;

    historyContainer.appendChild(div);
  });
}

async function renderAllTabsResults(results) {
  const container = document.getElementById("list");
  container.innerHTML = "";

  if (results.length === 0) {
    setStatus("No videos found in any tabs");
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
        </svg>
        <p>No videos found in any tabs</p>
      </div>
    `;
    return;
  }

  const totalVideos = results.reduce((sum, r) => sum + r.totalVideos, 0);
  setStatus(`Found ${totalVideos} video${totalVideos > 1 ? 's' : ''} across ${results.length} tab${results.length > 1 ? 's' : ''}`);

  results.forEach(result => {
    const { tab, domVideos, networkVideos } = result;

    // Tab header
    const tabHeader = document.createElement("div");
    tabHeader.style.cssText = "margin: 20px 0 12px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #667eea;";
    const tabTitle = tab.title || 'Untitled Tab';
    const displayTabTitle = tabTitle.length > 40 ? tabTitle.substring(0, 40) + '...' : tabTitle;
    tabHeader.innerHTML = `
      <div style="font-weight: 600; font-size: 13px; color: #333; margin-bottom: 2px;">${displayTabTitle}</div>
      <div style="font-size: 11px; color: #666;">${networkVideos.length + domVideos.length} video${networkVideos.length + domVideos.length > 1 ? 's' : ''}</div>
    `;
    container.appendChild(tabHeader);

    // Network videos
    if (networkVideos.length > 0) {
      const section = document.createElement("div");
      section.className = "section-title";
      section.textContent = `Network Videos (${networkVideos.length})`;
      container.appendChild(section);

      networkVideos.forEach((video, idx) => {
        const url = video.url || video;
        const downloaded = isDownloaded(url);
        const title = video.title || `Network Video ${idx + 1}`;
        const format = getVideoFormat(url);
        const size = video.size ? formatFileSize(video.size) : null;
        const displayTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;

        let metaHtml = '';
        if (size) {
          metaHtml = `<div class="video-meta">📦 ${size}</div>`;
        }

        const isStreaming = isStreamingFormat(url);
        const sizeText = size || '';
        const downloadText = isStreaming ? '⚠️ Stream Playlist' :
                            downloaded ? `Downloaded (${format})` :
                            sizeText ? `⬇ ${sizeText} • ${format}` : `⬇ ${format}`;
        const noteHtml = isStreaming ? '<div style="font-size: 10px; color: #f39c12; margin-top: 4px;">⚠️ Requires HLS downloader tool</div>' : '';
        const downloadedBadge = downloaded ? '<div class="downloaded-badge">Downloaded</div>' : '';
        const buttonClass = downloaded ? "download-network downloaded" : "download-network";

        const div = document.createElement("div");
        div.className = downloaded ? "video-item downloaded" : "video-item";
        div.innerHTML = `
          ${downloadedBadge}
          <div class="video-header">
            <div class="video-title" title="${title}">${displayTitle}</div>
            <div class="video-badge">${format}</div>
          </div>
          ${metaHtml}
          <div class="video-url" title="${url}">${url}</div>
          ${noteHtml}
          <div class="button-group">
            <button data-url="${encodeURIComponent(url)}" data-title="${title}" class="${buttonClass}">${downloadText}</button>
          </div>
        `;
        container.appendChild(div);
      });
    }

    // DOM videos
    if (domVideos.length > 0) {
      const section = document.createElement("div");
      section.className = "section-title";
      section.textContent = `Page Videos (${domVideos.length})`;
      container.appendChild(section);

      domVideos.forEach((v) => {
        const downloaded = v.currentSrc && isDownloaded(v.currentSrc);
        const format = v.currentSrc ? getVideoFormat(v.currentSrc) : 'Unknown';
        const title = v.title || `Video ${v.index + 1}`;
        const displayTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
        const duration = v.formattedDuration || 'Unknown';

        let buttonsHtml = '';
        if (v.allSources && v.allSources.length > 0) {
          buttonsHtml = v.allSources.map((src, idx) => {
            const srcFormat = getVideoFormat(src);
            const srcDownloaded = isDownloaded(src);
            const btnClass = srcDownloaded ? "download-network downloaded" : "download-network";
            const btnText = srcDownloaded ? `Downloaded (${srcFormat})` : `⬇ ${srcFormat}`;
            return `<button data-url="${encodeURIComponent(src)}" data-title="${title}" class="${btnClass}">${btnText}</button>`;
          }).join('');
        } else {
          buttonsHtml = '<button disabled>No source available</button>';
        }

        const downloadedBadge = downloaded ? '<div class="downloaded-badge">Downloaded</div>' : '';

        const div = document.createElement("div");
        div.className = downloaded ? "video-item downloaded" : "video-item";
        div.innerHTML = `
          ${downloadedBadge}
          <div class="video-header">
            <div class="video-title" title="${title}">${displayTitle}</div>
            <div class="video-badge">${format}</div>
          </div>
          <div class="video-meta with-duration">${v.width}×${v.height} • ${duration}</div>
          <div class="video-url" title="${v.currentSrc || 'No source'}">${v.currentSrc || '(no source)'}</div>
          <div class="button-group">
            ${buttonsHtml}
          </div>
        `;
        container.appendChild(div);
      });
    }
  });

  // Add download listeners
  container.querySelectorAll(".download-network").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const url = decodeURIComponent(e.target.dataset.url);
      const title = e.target.dataset.title;
      downloadNetworkVideo(url, title);
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load downloaded videos from storage first
  await loadDownloadedVideos();

  // Render download history
  await renderDownloadHistory();

  // Then query videos
  queryVideosInActiveTab();

  // Add refresh button listener
  document.getElementById("refresh").addEventListener("click", () => {
    queryVideosInActiveTab();
  });

  // Add scan all tabs button listener
  document.getElementById("scan-all").addEventListener("click", () => {
    queryVideosInAllTabs();
  });
});
