/* PMS-cog service worker：讓加入主畫面後離線也能開頁面。
 * 策略：同網域檔案「先連網、失敗用快取」（有網路永遠拿最新版，不必改版本號）；
 *       Apps Script／Google Fonts 等外部網址不經快取。
 * 第一次安裝時預先抓齊所有頁面，之後每次成功載入都更新快取。
 */
const CACHE = 'pms-cog-v1';
const PRECACHE = [
  './', './index.html', './qor15.html', './eq5d.html', './manifest.json',
  './_shared/config.js', './_shared/core.js', './_shared/pms.css',
  './tests/memory.html', './tests/groceries.html', './tests/lines.html',
  './fun/index.html', './fun/match.html', './fun/onet.html', './fun/slide.html',
  './staff/bind.html', './staff/minicog.html', './staff/results.html',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // 外部請求（Apps Script、字型）不處理
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
