// popup.js - Tabbed UI with queue management

let currentTabId = null;
let netVideos = [];
let blobVideos = [];
let domVideos = [];
let selectedVideos = new Set();
let queueJobs = [];

// ===== Tab Management =====

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  if (tabName === 'queue') {
    refreshQueue();
  }
}

// ===== Discovery =====

function renderDiscoverTab() {
  const container = document.getElementById('discover-list');
  container.innerHTML = '';

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
    setStatus('No videos detected');
    return;
  }

  setStatus(`Found ${allVideos.length} video${allVideos.length > 1 ? 's' : ''}`);

  // Network videos
  if (netVideos.length > 0) {
    const section = document.createElement('div');
    section.className = 'section-title';
    section.textContent = `Network Videos (${netVideos.length})`;
    container.appendChild(section);

    netVideos.forEach((v, idx) => {
      container.appendChild(createVideoItem(v, `net-${idx}`));
    });
  }

  // DOM videos
  if (domVideos.length > 0) {
    const section = document.createElement('div');
    section.className = 'section-title';
    section.textContent = `Page Videos (${domVideos.length})`;
    container.appendChild(section);

    domVideos.forEach((v, idx) => {
      container.appendChild(createVideoItem(v, `dom-${idx}`));
    });
  }

  // Blob videos
  if (blobVideos.length > 0) {
    const section = document.createElement('div');
    section.className = 'section-title';
    section.textContent = `Blob Videos (${blobVideos.length})`;
    container.appendChild(section);

    blobVideos.forEach((v, idx) => {
      container.appendChild(createVideoItem(v, `blob-${idx}`));
    });
  }

  updateBulkActions();
}

function createVideoItem(video, itemId) {
  const div = document.createElement('div');
  div.className = 'video-item';
  if (selectedVideos.has(itemId)) div.classList.add('selected');

  const url = video.url || video.src || '';
  const format = getVideoFormat(url);
  const size = formatFileSize(video.size);
  const mode = detectMode(url);
  const quality = video.quality || getQualityFromSize(video.width, video.height);

  div.innerHTML = `
    <input type="checkbox" class="video-checkbox" data-item="${itemId}" ${selectedVideos.has(itemId) ? 'checked' : ''}>
    <div class="video-content">
      <div class="video-header">
        <div class="video-title">${video.title || `${format} Video`}</div>
        <div class="video-badge">${format}</div>
      </div>
      ${size || quality ? `<div class="video-meta">
        ${size ? `📦 ${size}` : ''}
        ${quality ? `<span>${quality}</span>` : ''}
        ${mode !== 'http' ? `<span style="color:#f39c12">${mode.toUpperCase()}</span>` : ''}
      </div>` : ''}
      <div class="video-url" title="${url}">${url}</div>
      <div class="button-group">
        <button class="download-btn" data-item="${itemId}">⬇ Download</button>
      </div>
    </div>
  `;

  const checkbox = div.querySelector('.video-checkbox');
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectedVideos.add(itemId);
      div.classList.add('selected');
    } else {
      selectedVideos.delete(itemId);
      div.classList.remove('selected');
    }
    updateBulkActions();
  });

  const downloadBtn = div.querySelector('.download-btn');
  downloadBtn.addEventListener('click', () => {
    enqueueVideo(video);
  });

  return div;
}

function enqueueVideo(video) {
  const url = video.url || video.src || '';
  const item = {
    url,
    mode: detectMode(url),
    size: video.size || null,
    quality: video.quality || getQualityFromSize(video.width, video.height),
    filenameHint: getFilenameHint(video, url)
  };

  const options = {
    convert: getSettings().autoConvert ? { container: getSettings().defaultContainer, codec: 'copy' } : null,
    mergeAV: getSettings().mergeAV
  };

  chrome.runtime.sendMessage({
    type: 'VIDOWN_ENQUEUE',
    item,
    options
  }, (response) => {
    if (response?.success) {
      setStatus(`Added to queue: ${item.filenameHint}`);
      switchTab('queue');
    } else {
      setStatus('⚠ Failed to enqueue download');
    }
  });
}

function getFilenameHint(video, url) {
  if (video.title) return sanitizeFilename(video.title) + '.mp4';

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

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '-').substring(0, 200);
}

// ===== Queue Management =====

function refreshQueue() {
  chrome.runtime.sendMessage({ type: 'VIDOWN_GET_QUEUE' }, (response) => {
    if (response?.jobs) {
      queueJobs = response.jobs;
      renderQueueTab();
      updateQueueCount();
    }
  });
}

function renderQueueTab() {
  const container = document.getElementById('queue-list');
  container.innerHTML = '';

  if (queueJobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No downloads in queue</p>
      </div>
    `;
    return;
  }

  queueJobs.forEach(job => {
    container.appendChild(createQueueItem(job));
  });
}

function createQueueItem(job) {
  const div = document.createElement('div');
  div.className = `queue-item ${job.state}`;
  div.dataset.jobId = job.id;

  const stateLabel = job.state.charAt(0).toUpperCase() + job.state.slice(1);
  const percent = job.percent || 0;
  const speed = formatSpeed(job.speedBytesPerSec);
  const eta = formatEta(job.etaSeconds);

  div.innerHTML = `
    <div class="queue-header">
      <div class="queue-filename">${job.filename || 'Unknown'}</div>
      <div class="queue-state ${job.state}">${stateLabel}</div>
    </div>
    ${job.state === 'active' || job.state === 'retrying' ? `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="queue-meta">
        <span>${percent}%</span>
        <span>${speed || '--'} ${eta ? `• ${eta}` : ''}</span>
      </div>
    ` : ''}
    ${job.error ? `<div style="color: #dc3545; font-size: 11px; margin-bottom: 8px;">${job.error}</div>` : ''}
    <div class="queue-controls">
      ${job.state === 'active' ? `<button class="secondary" data-action="pause" data-job="${job.id}">⏸ Pause</button>` : ''}
      ${job.state === 'paused' ? `<button data-action="resume" data-job="${job.id}">▶ Resume</button>` : ''}
      ${job.state !== 'complete' ? `<button class="danger" data-action="cancel" data-job="${job.id}">✕ Cancel</button>` : ''}
    </div>
  `;

  // Add control listeners
  div.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const jobId = e.target.dataset.job;
      handleQueueAction(action, jobId);
    });
  });

  return div;
}

function handleQueueAction(action, jobId) {
  const messageType = `VIDOWN_${action.toUpperCase()}_JOB`;
  chrome.runtime.sendMessage({ type: messageType, jobId }, () => {
    setTimeout(refreshQueue, 100);
  });
}

function updateQueueCount() {
  const count = queueJobs.filter(j => j.state !== 'complete' && j.state !== 'error').length;
  document.getElementById('queue-count').textContent = count;
}

// ===== Bulk Actions =====

function updateBulkActions() {
  const count = selectedVideos.size;
  const bulkActionsDiv = document.getElementById('bulk-actions');
  const countSpan = document.getElementById('selected-count');

  if (count > 0) {
    bulkActionsDiv.classList.add('visible');
    countSpan.textContent = count;
  } else {
    bulkActionsDiv.classList.remove('visible');
  }
}

function bulkDownload() {
  const videos = getAllVideos();
  let queued = 0;

  selectedVideos.forEach(itemId => {
    const video = videos.find((v, idx) => {
      const prefix = v.url ? 'net' : (v.src ? 'dom' : 'blob');
      return `${prefix}-${idx}` === itemId;
    });

    if (video) {
      enqueueVideo(video);
      queued++;
    }
  });

  selectedVideos.clear();
  renderDiscoverTab();
  setStatus(`Added ${queued} videos to queue`);
  setTimeout(() => switchTab('queue'), 500);
}

function getAllVideos() {
  return [...netVideos, ...domVideos, ...blobVideos];
}

// ===== Helpers =====

function setStatus(text) {
  document.getElementById('status').textContent = text;
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

function detectMode(url) {
  if (/\.m3u8($|\?)/i.test(url)) return 'hls';
  if (/\.mpd($|\?)/i.test(url)) return 'dash';
  if (url.startsWith('blob:')) return 'blob';
  return 'http';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatSpeed(bps) {
  if (!bps) return '';
  const kb = 1024;
  const mb = kb * 1024;
  if (bps >= mb) return `${(bps / mb).toFixed(1)} MB/s`;
  if (bps >= kb) return `${(bps / kb).toFixed(0)} KB/s`;
  return `${bps | 0} B/s`;
}

function formatEta(sec) {
  if (!sec || sec <= 0) return '';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function getQualityFromSize(width, height) {
  if (!width || !height) return '';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  return `${height}p`;
}

function getSettings() {
  return {
    autoConvert: document.getElementById('setting-auto-convert')?.checked ?? true,
    defaultContainer: document.getElementById('setting-default-container')?.value || 'mp4',
    mergeAV: document.getElementById('setting-merge-av')?.checked ?? true,
    quickDownload: document.getElementById('setting-quick-download')?.checked ?? false
  };
}

// ===== Init =====

document.addEventListener('DOMContentLoaded', async () => {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      switchTab(e.target.dataset.tab);
    });
  });

  // Bulk actions
  document.getElementById('bulk-download').addEventListener('click', bulkDownload);
  document.getElementById('bulk-clear').addEventListener('click', () => {
    selectedVideos.clear();
    renderDiscoverTab();
  });

  // Refresh button
  document.getElementById('refresh').addEventListener('click', () => {
    location.reload();
  });

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus('No active tab');
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
      renderDiscoverTab();
    }
  });

  // Listen for updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'DOM_VIDEOS') {
      domVideos = msg.items || [];
      renderDiscoverTab();
    }

    if (msg?.type === 'JOB_ADDED' || msg?.type === 'JOB_PROGRESS' || msg?.type === 'JOB_DONE' || msg?.type === 'JOB_ERROR') {
      refreshQueue();
    }
  });

  // Initial queue refresh
  refreshQueue();

  // Auto-refresh queue every 2 seconds
  setInterval(refreshQueue, 2000);
});
