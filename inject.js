// inject.js - Ultra-lightweight blob interceptor (like VideoDownloadHelper)

(function() {
  'use strict';

  const orig = URL.createObjectURL;
  const blobs = new Map();

  // Intercept synchronously - just reads blob.size (instant, no I/O)
  URL.createObjectURL = function(blob) {
    const url = orig.call(this, blob);

    // Only track video blobs > 512KB to minimize overhead
    if (blob.type.startsWith('video/') && blob.size > 524288) {
      blobs.set(url, { url, size: blob.size, type: blob.type });

      // Post message async (doesn't block createObjectURL)
      setTimeout(() => {
        window.postMessage({ type: 'VIDOWN_BLOB_CREATED', data: blobs.get(url) }, '*');
      }, 0);
    }

    return url;
  };

  // Clean up revoked blobs
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = function(url) {
    if (blobs.has(url)) {
      setTimeout(() => {
        window.postMessage({ type: 'VIDOWN_BLOB_REVOKED', data: { url } }, '*');
      }, 0);
      blobs.delete(url);
    }
    return origRevoke.call(this, url);
  };
})();
