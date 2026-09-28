// Optional short bookmarklet. The application still reads and changes bids only on CMT.
(() => {
  if (window.__PURR_REVIEW__?.focus) return window.__PURR_REVIEW__.focus();
  const id = 'purr-review-loader';
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.crossOrigin = 'anonymous';
  script.referrerPolicy = 'no-referrer';
  // A fresh URL avoids the host/browser cache retaining an older release.
  script.src = 'https://wanshenl.me/purr-review/dist/purr-review.js?t=' + Date.now();
  let timer;
  const finish = failed => {
    clearTimeout(timer);
    script.onload = script.onerror = null;
    script.remove();
    if (failed) alert('Purr Review could not load. Check your connection; this page may block external scripts. The full desktop bookmark is available on the install page.');
  };
  script.onload = () => finish(!window.__PURR_REVIEW__);
  script.onerror = () => finish(true);
  timer = setTimeout(() => finish(true), 15000);
  document.documentElement.append(script);
})();
