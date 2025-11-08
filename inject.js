// inject.js - Ultra-lightweight blob interceptor
(() => {
  if (window.__VIDOWN_WRAP) return;
  window.__VIDOWN_WRAP = true;

  const orig = URL.createObjectURL;

  URL.createObjectURL = function(obj) {
    try {
      if (obj && typeof obj.size === 'number' && obj.size >= 524288) {
        const type = typeof obj.type === 'string' ? obj.type : '';
        // Only consider likely videos
        if (type.startsWith('video/')) {
          const payload = {
            __vidown: true,
            kind: 'blob-meta',
            size: obj.size,
            type,
            ts: Date.now()
          };
          // Never block blob creation
          setTimeout(() => window.postMessage(payload, "*"), 0);
        }
      }
    } catch (_) { /* swallow */ }

    return orig.apply(this, arguments);
  };
})();
