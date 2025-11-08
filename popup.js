// popup.js - Lean, fast video detection

let currentTabId = null;
let netVideos = [];
let blobVideos = [];
let domVideos = [];
const downloadedVideos = new Set();

// ===== Load storage =====

async function loadDownloadedVideos() {
  const result = await chrome.storage.local.get(['downloadedVideos']);
  if (result.downloadedVideos) {
    result.downloadedVideos.forEach(url => downloadedVideos.add(url));
  }
}

async function markAsDownloaded(url) {
  downloadedVideos.add(url);
  await chrome.storage.local.set({
    downloadedVideos: Array.from(downloadedVideos)
  });
}

function isDownloaded(url) {
  return downloadedVideos.has(url);
}

async function loadDownloadHistory() {
  const result = await chrome.storage.local.get(['downloadHistory']);
  return result.downloadHistory || [];
}

async function saveToHistory(url, filename, size, location = null) {
  const history = await loadDownloadHistory();
  const settings = await loadSettings();

  history.unshift({
    url,
    filename,
    size,
    location: location || settings.downloadPath || 'Downloads',
    timestamp: Date.now()
  });

  const limit = settings.historyLimit || 50;
  await chrome.storage.local.set({ downloadHistory: history.slice(0, limit) });
}

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

// ===== Helpers =====

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getVideoFormat(url) {
  if (url.startsWith('blob:')) return 'Video';
  const ext = url.split('.').pop().split('?')[0].toLowerCase();
  const formats = {
    'mp4': 'MP4', 'webm': 'WebM', 'mov': 'MOV', 'avi': 'AVI',
    'mkv': 'MKV', 'flv': 'FLV', 'm3u8': 'HLS', 'mpd': 'DASH',
    'm4v': 'M4V', 'ogg': 'OGG'
  };
  return formats[ext] || ext.toUpperCase();
}

function isLikelyHLS(url, type) {
  return /\.m3u8($|\?)/i.test(url) ||
         (type && /application\/(vnd\.apple\.mpegurl|x-mpegURL)/i.test(type));
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

// ===== Render UI =====

function renderVideos() {
  const container = document.getElementById("list");
  container.innerHTML = "";

  const allVideos = [...netVideos, ...blobVideos, ...domVideos];

  if (allVideos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
        </svg>
        <p>No videos found on this page</p>
      </div>
    `;
    setStatus("No videos detected");
    return;
  }

  setStatus(`Found ${allVideos.length} video${allVideos.length > 1 ? 's' : ''}`);

  // Network videos
  if (netVideos.length > 0) {
    const section = document.createElement("div");
    section.className = "section-title";
    section.textContent = `Network Videos (${netVideos.length})`;
    container.appendChild(section);

    netVideos.forEach((v) => {
      const div = document.createElement("div");
      const downloaded = isDownloaded(v.url);
      div.className = downloaded ? "video-item downloaded" : "video-item";

      const format = getVideoFormat(v.url);
      const sizeText = v.size ? formatFileSize(v.size) : '';
      const isHLS = isLikelyHLS(v.url, v.type);

      const downloadText = isHLS ? '⚠️ HLS Stream' :
                          downloaded ? `Downloaded (${format})` :
                          sizeText ? `⬇ ${sizeText} • ${format}` : `⬇ ${format}`;

      const hlsNote = isHLS ? '<div style="font-size: 10px; color: #f39c12; margin-top: 4px;">⚠️ Requires HLS downloader tool</div>' : '';

      div.innerHTML = `
        ${downloaded ? '<div class="downloaded-badge">Downloaded</div>' : ''}
        <div class="video-header">
          <div class="video-title">${format} Video</div>
          <div class="video-badge">${format}</div>
        </div>
        ${sizeText ? `<div class="video-meta">📦 ${sizeText}</div>` : ''}
        <div class="video-url" title="${v.url}">${v.url}</div>
        ${hlsNote}
        <div class="button-group">
          <button data-url="${encodeURIComponent(v.url)}" class="download-btn ${downloaded ? 'downloaded' : ''}">${downloadText}</button>
        </div>
      `;
      container.appendChild(div);
    });
  }

  // Blob videos
  if (blobVideos.length > 0) {
    const section = document.createElement("div");
    section.className = "section-title";
    section.textContent = `Blob Videos (${blobVideos.length})`;
    container.appendChild(section);

    blobVideos.forEach((v, idx) => {
      const div = document.createElement("div");
      div.className = "video-item";

      const sizeText = formatFileSize(v.size);
      const type = v.type || 'video/*';

      div.innerHTML = `
        <div class="video-header">
          <div class="video-title">Blob Video ${idx + 1}</div>
          <div class="video-badge">BLOB</div>
        </div>
        <div class="video-meta">📦 ${sizeText} • ${type}</div>
        <div class="video-url">blob: URL (in-memory)</div>
        <div class="button-group">
          <button disabled>Cannot download blob URLs</button>
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

    domVideos.forEach((v, idx) => {
      const div = document.createElement("div");
      const downloaded = isDownloaded(v.src);
      div.className = downloaded ? "video-item downloaded" : "video-item";

      const format = getVideoFormat(v.src);
      const duration = v.duration ? `${Math.floor(v.duration / 60)}:${String(Math.floor(v.duration % 60)).padStart(2, '0')}` : 'Unknown';

      div.innerHTML = `
        ${downloaded ? '<div class="downloaded-badge">Downloaded</div>' : ''}
        <div class="video-header">
          <div class="video-title">${v.title || `Video ${idx + 1}`}</div>
          <div class="video-badge">${format}</div>
        </div>
        <div class="video-meta">${v.width}×${v.height} • ${duration}</div>
        <div class="video-url" title="${v.src}">${v.src}</div>
        <div class="button-group">
          <button data-url="${encodeURIComponent(v.src)}" class="download-btn ${downloaded ? 'downloaded' : ''}">${downloaded ? 'Downloaded' : '⬇ Download'}</button>
        </div>
      `;
      container.appendChild(div);
    });
  }

  // Add download listeners
  container.querySelectorAll(".download-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const url = decodeURIComponent(e.target.dataset.url);
      downloadVideo(url);
    });
  });
}

// ===== Download =====

async function downloadVideo(url) {
  setStatus("Downloading...");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const filename = getDownloadFilename(url);

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(link.href), 100);

    await markAsDownloaded(url);
    const settings = await loadSettings();
    await saveToHistory(url, filename, blob.size, settings.downloadPath);

    setStatus(`✓ Downloaded (${formatFileSize(blob.size)})`);
    await renderDownloadHistory();
    renderVideos(); // Refresh to show downloaded badge
  } catch (err) {
    console.error("Download failed:", err);
    // Fallback to chrome.downloads API
    try {
      chrome.downloads.download({ url, saveAs: false });
      setStatus("✓ Download started");
    } catch (_) {
      chrome.tabs.create({ url });
      setStatus("⚠ Opened in new tab");
    }
  }
}

function getDownloadFilename(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    if (filename && filename.includes('.')) {
      return filename.split('?')[0];
    }
  } catch (_) {}

  const format = getVideoFormat(url).toLowerCase();
  return `video-${Date.now()}.${format}`;
}

// ===== History =====

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

  history.slice(0, 10).forEach((entry) => {
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

// ===== Init =====

document.addEventListener("DOMContentLoaded", async () => {
  // Load storage
  await loadDownloadedVideos();
  await renderDownloadHistory();

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus("No active tab");
    return;
  }

  currentTabId = tab.id;

  // Notify service worker popup opened
  chrome.runtime.sendMessage({ type: 'POPUP_OPENED', tabId: currentTabId }).catch(() => {});

  // Request current state
  chrome.runtime.sendMessage({ type: 'REQUEST_STATE', tabId: currentTabId }, (response) => {
    if (response?.type === 'STATE') {
      netVideos = response.net || [];
      blobVideos = response.blobs || [];
      renderVideos();
    }
  });

  // Listen for DOM videos
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'DOM_VIDEOS') {
      domVideos = msg.items || [];
      renderVideos();
    }
  });

  // Refresh button
  document.getElementById("refresh")?.addEventListener("click", () => {
    location.reload();
  });
});
