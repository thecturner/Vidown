// options.js

// Default settings
const DEFAULT_SETTINGS = {
  downloadPath: '',
  askLocation: false,
  autoConvert: true,
  showBadge: true,
  historyLimit: 50
};

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return result.settings || DEFAULT_SETTINGS;
}

// Save settings to storage
async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// Show status message
function showStatus(message, isError = false) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = 'status-message ' + (isError ? 'error' : 'success');

  setTimeout(() => {
    statusEl.className = 'status-message';
  }, 3000);
}

// Populate form with current settings
async function populateForm() {
  const settings = await loadSettings();

  document.getElementById('download-path').value = settings.downloadPath || '';
  document.getElementById('ask-location').checked = settings.askLocation;
  document.getElementById('auto-convert').checked = settings.autoConvert;
  document.getElementById('show-badge').checked = settings.showBadge;
  document.getElementById('history-limit').value = settings.historyLimit;
}

// Save button handler
document.getElementById('save').addEventListener('click', async () => {
  const downloadPath = document.getElementById('download-path').value.trim();
  const askLocation = document.getElementById('ask-location').checked;
  const autoConvert = document.getElementById('auto-convert').checked;
  const showBadge = document.getElementById('show-badge').checked;
  const historyLimit = parseInt(document.getElementById('history-limit').value, 10);

  // Validate history limit
  if (isNaN(historyLimit) || historyLimit < 1 || historyLimit > 500) {
    showStatus('History limit must be between 1 and 500', true);
    return;
  }

  const settings = {
    downloadPath,
    askLocation,
    autoConvert,
    showBadge,
    historyLimit
  };

  await saveSettings(settings);
  showStatus('Settings saved successfully!');
});

// Reset button handler
document.getElementById('reset').addEventListener('click', async () => {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    await saveSettings(DEFAULT_SETTINGS);
    await populateForm();
    showStatus('Settings reset to defaults');
  }
});

// Clear history button handler
document.getElementById('clear-history').addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all download history?')) {
    await chrome.storage.local.set({ downloadHistory: [] });
    showStatus('Download history cleared');
  }
});

// Initialize form on page load
document.addEventListener('DOMContentLoaded', populateForm);
