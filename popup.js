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
      // Find the video to get size
      const video = [...netVideos, ...domVideos].find(v => v.url === url || v.src === url);
      const size = video?.size || video?.sizeBytes || null;
      downloadVideo(url, size);
    });
  });
}

// ===== Download =====

function downloadVideo(url, expectedBytes) {
  const filename = getDownloadFilename(url);

  console.log('[Vidown Popup] Requesting download:', { url, filename, expectedBytes });

  // Start download via service worker
  chrome.runtime.sendMessage({
    type: "VIDOWN_START_DOWNLOAD",
    url,
    filename,
    expectedTotalBytes: expectedBytes ?? null
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Vidown Popup] Message send error:', chrome.runtime.lastError);
      setStatus("⚠ Error: Could not reach service worker");
    }
  });

  setStatus("Starting download...");
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

// Progress bar helpers
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function estimatePercent(bytes, total) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((bytes / total) * 100)));
}

function formatEta(eta, speed) {
  if (eta == null || !Number.isFinite(eta)) {
    if (speed && speed > 0) return formatSpeed(speed);
    return "--";
  }
  if (eta < 60) return `${eta}s`;
  const m = Math.floor(eta / 60);
  const s = eta % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function formatSpeed(bps) {
  const kb = 1024;
  const mb = kb * 1024;
  if (bps >= mb) return `${(bps / mb).toFixed(1)} MB/s`;
  if (bps >= kb) return `${(bps / kb).toFixed(0)} KB/s`;
  return `${bps | 0} B/s`;
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

  // Listen for DOM videos and download progress
  const jobsEl = document.getElementById("jobs");
  const jobsSection = document.getElementById("jobs-section");

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'DOM_VIDEOS') {
      domVideos = msg.items || [];
      renderVideos();
    }

    // Download error messages
    if (msg?.type === "VIDOWN_DOWNLOAD_ERROR") {
      console.error('[Vidown Popup] Download error:', msg);
      setStatus(`⚠ Download failed: ${msg.error || 'Unknown error'}`);
      return;
    }

    // Download progress messages
    if (msg?.type === "VIDOWN_DOWNLOAD_STARTED") {
      const { downloadId, filename, expectedTotalBytes } = msg.job;
      jobsSection.style.display = "block";

      const el = document.createElement("div");
      el.className = "job";
      el.dataset.id = String(downloadId);
      el.innerHTML = `
        <div class="job-row">
          <span class="job-name">${escapeHtml(filename)}</span>
          <span class="job-meta"><span class="pct">0%</span> · <span class="eta">--</span></span>
        </div>
        <div class="job-bar"><div class="job-fill" style="width:0%"></div></div>`;
      jobsEl.appendChild(el);
    }

    if (msg?.type === "VIDOWN_DOWNLOAD_PROGRESS") {
      const { downloadId, percent, speedBytesPerSec, etaSeconds, expectedTotalBytes, bytesReceived } = msg.job;
      const el = jobsEl.querySelector(`.job[data-id="${downloadId}"]`);
      if (!el) return;

      const pct = percent != null ? percent : estimatePercent(bytesReceived, expectedTotalBytes);
      el.querySelector(".job-fill").style.width = `${pct}%`;
      el.querySelector(".pct").textContent = `${pct}%`;
      el.querySelector(".eta").textContent = formatEta(etaSeconds, speedBytesPerSec);
    }

    if (msg?.type === "VIDOWN_DOWNLOAD_DONE") {
      const { downloadId, state, url, filename } = msg.job;
      const el = jobsEl.querySelector(`.job[data-id="${downloadId}"]`);
      if (!el) return;

      if (state === "complete") {
        el.querySelector(".pct").textContent = "100%";
        el.querySelector(".eta").textContent = "Done";
        el.querySelector(".job-fill").style.width = "100%";

        // Mark as downloaded and save to history
        markAsDownloaded(url).then(() => {
          // Try to get size from the completed download
          chrome.downloads.search({ id: parseInt(downloadId) }, (results) => {
            if (results && results[0]) {
              const size = results[0].fileSize || results[0].totalBytes || 0;
              loadSettings().then(settings => {
                saveToHistory(url, filename, size, settings.downloadPath);
                renderDownloadHistory();
              });
            }
          });
        });

        renderVideos(); // Refresh to show downloaded badge

        setTimeout(() => {
          el.remove();
          if (jobsEl.children.length === 0) {
            jobsSection.style.display = "none";
          }
        }, 5000);
      } else {
        el.querySelector(".eta").textContent = "Interrupted";
        el.classList.add("error");
        setTimeout(() => {
          el.remove();
          if (jobsEl.children.length === 0) {
            jobsSection.style.display = "none";
          }
        }, 8000);
      }
    }
  });

  // Refresh button
  document.getElementById("refresh")?.addEventListener("click", () => {
    location.reload();
  });
});
