// content_script.js - On-demand injection and message relay
(() => {
  let injected = false;

  // Listen to page messages from inject.js
  window.addEventListener('message', (ev) => {
    const d = ev?.data;
    if (!d || d.__vidown !== true || d.kind !== 'blob-meta') return;

    // Forward to SW asynchronously
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'BLOB_META', meta: d }).catch(() => {});
    }, 0);
  });

  // Handle requests from popup/SW
  chrome.runtime.onMessage.addListener((msg, _sender, _respond) => {
    if (msg?.type === 'VIDOWN_ARM') {
      if (!injected) {
        injected = true;
        chrome.runtime.sendMessage({ type: 'VIDOWN_ARMED' }).catch(() => {});
        try {
          // Programmatic injection of the page-context interceptor
          if (chrome.runtime.getURL) {
            const src = chrome.runtime.getURL('inject.js');
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            (document.documentElement || document.head || document.body).appendChild(s);
          }
        } catch (_) { /* swallow */ }
      }
    } else if (msg?.type === 'SCAN_DOM_VIDEOS') {
      const out = [];
      document.querySelectorAll('video').forEach(v => {
        const src = v.currentSrc || v.src || '';
        if (src) {
          out.push({
            src,
            width: v.videoWidth || 0,
            height: v.videoHeight || 0,
            duration: isFinite(v.duration) ? v.duration : null,
            title: v.title || null
          });
        }
      });
      chrome.runtime.sendMessage({ type: 'DOM_VIDEOS', items: out }).catch(() => {});
    }
  });
})();
