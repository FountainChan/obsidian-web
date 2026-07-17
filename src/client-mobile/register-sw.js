// רישום ה-Service Worker (offline + asset-cache — docs/plans/service-worker-offline.md §3ב).
// Non-blocking: נטען אחרי window 'load' כדי שלא יעכב את ה-boot spinner.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[ow] SW register failed', e));
  });
}
