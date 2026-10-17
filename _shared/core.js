/* PMS-cog 共用前端模組：Apps Script 連線、平板綁定狀態、離線排隊送出、小工具
 * 所有頁面以 <script src="../_shared/core.js"> 載入後使用全域 COG。
 */
(function () {
  // 後端網址來自 _shared/config.js（PMS-cog 自己的 Apps Script，與主系統分開）
  const CFG = window.COG_CONFIG || {};
  const APPS_SCRIPT_URL = CFG.APPS_SCRIPT_URL || '';
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) console.warn('PMS-cog：尚未在 _shared/config.js 設定 APPS_SCRIPT_URL');
  const LS = { token: 'cog-token', patient: 'cog-patient', queue: 'cog-queue', device: 'cog-device', staffKey: 'cog-staff-key', lookup: 'cog-last-lookup' };

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    json(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  };

  // 裝置代號：第一次開啟時產生（例如 iPad-3F7K），護理師可在綁定頁改名
  function deviceId() {
    let d = ls.get(LS.device);
    if (!d) { d = 'iPad-' + Math.random().toString(36).slice(2, 6).toUpperCase(); ls.set(LS.device, d); }
    return d;
  }

  // JSONP GET（與 PMS-csc 各頁相同作法）
  function jsonp(params, timeoutMs) {
    timeoutMs = timeoutMs || 25000;
    return new Promise((resolve, reject) => {
      const cb = '_cog_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const usp = new URLSearchParams(Object.assign({}, params, { callback: cb }));
      const s = document.createElement('script');
      const t = setTimeout(() => { cl(); reject(new Error('查詢逾時')); }, timeoutMs);
      function cl() { clearTimeout(t); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = d => { cl(); resolve(d); };
      s.onerror = () => { cl(); reject(new Error('連線失敗')); };
      s.src = APPS_SCRIPT_URL + '?' + usp.toString();
      document.body.appendChild(s);
    });
  }

  // POST（no-cors，拿不到回應；網路層失敗會 throw → 進排隊）
  async function postNow(data) {
    const fd = new FormData();
    Object.keys(data).forEach(k => fd.append(k, data[k] == null ? '' : data[k]));
    await fetch(APPS_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: fd, cache: 'no-store' });
  }

  // 離線排隊：送不出去先存，之後有網路再補送。回傳 'sent' 或 'queued'
  async function submit(data) {
    data = Object.assign({ device: deviceId(), clientTs: new Date().toISOString() }, data);
    if (!data.token && data.action !== 'submitMiniCog') data.token = ls.get(LS.token) || '';
    if (navigator.onLine === false) { enqueue(data); return 'queued'; }
    try { await postNow(data); return 'sent'; }
    catch (e) { enqueue(data); return 'queued'; }
  }
  function enqueue(data) { const q = ls.json(LS.queue, []); q.push(data); ls.set(LS.queue, JSON.stringify(q)); }
  function queueLength() { return ls.json(LS.queue, []).length; }
  let flushing = false;
  async function flushQueue() {
    if (flushing) return;
    const q = ls.json(LS.queue, []);
    if (!q.length || navigator.onLine === false) return;
    flushing = true;
    const rest = [];
    for (const item of q) {
      try { await postNow(item); } catch (e) { rest.push(item); }
    }
    ls.set(LS.queue, JSON.stringify(rest));
    flushing = false;
    document.dispatchEvent(new CustomEvent('cog-queue', { detail: { remaining: rest.length } }));
  }
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushQueue(); });
  setTimeout(flushQueue, 800);

  // 綁定狀態
  const session = {
    token() { return ls.get(LS.token) || ''; },
    patient() { return ls.json(LS.patient, null); },
    setBinding(token, patient) { ls.set(LS.token, token); ls.set(LS.patient, JSON.stringify(patient || {})); ls.del(LS.lookup); },
    clear() { ls.del(LS.token); ls.del(LS.patient); ls.del(LS.lookup); },
    staffKey() { return ls.get(LS.staffKey) || ''; },
    setStaffKey(k) { if (k) ls.set(LS.staffKey, k); else ls.del(LS.staffKey); },
    // 查詢今日時點；離線時用上次結果
    async lookup() {
      const token = this.token();
      if (!token) return { ok: false, reason: 'unbound' };
      try {
        const d = await jsonp({ action: 'lookupTablet', token: token }, 20000);
        if (d && d.ok) ls.set(LS.lookup, JSON.stringify(Object.assign({ cachedAt: Date.now() }, d)));
        if (d && d.ok === false && d.reason === 'unbound') this.clear();
        return d;
      } catch (e) {
        const c = ls.json(LS.lookup, null);
        if (c) return Object.assign({}, c, { offline: true });
        return { ok: false, reason: 'offline' };
      }
    },
  };

  // 網址 ?phase=T1 可覆寫（由 index.html 帶入，避免每頁再查一次）
  function phaseFromUrl() { const m = location.search.match(/[?&]phase=(T[0-3])/); return m ? m[1] : ''; }
  const PHASE_LABEL = { T0: '術前', T1: '術後第一天', T2: '術後第三天', T3: '出院前' };

  function $(id) { return document.getElementById(id); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function fmtTime(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

  // 回報休閒遊戲使用量（累計到離開頁面或每 5 局送一次）
  function funLogger(game) {
    let rounds = 0, start = Date.now(), sentRounds = 0, sentMin = 0;
    function flush(force) {
      const minutes = Math.round((Date.now() - start) / 6000) / 10;
      const dr = rounds - sentRounds, dm = Math.round((minutes - sentMin) * 10) / 10;
      if (!session.token()) return;
      if (!force && dr < 5) return;
      if (dr <= 0 && dm < 1) return;
      sentRounds = rounds; sentMin = minutes;
      submit({ action: 'logFun', game: game, rounds: dr, minutes: dm });
    }
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
    return { round() { rounds++; flush(false); }, flush: () => flush(true) };
  }

  // 認知測驗結束：送出分數與原始指標，回傳 'sent'/'queued'
  async function finishTest(test, score, metrics, seconds) {
    const phase = phaseFromUrl() || 'T0';
    const r = await submit({ action: 'submitTest', phase, test, score: Math.round(score), metrics: JSON.stringify(metrics || {}), seconds: Math.round(seconds || 0) });
    try { localStorage.setItem('cog-test-' + test + '-' + phase + '-' + session.token(), String(Math.round(score))); } catch (e) {}
    return r;
  }
  // 以亂數種子產生可重現的隨機數（每次測驗題目不同，但可從 metrics.seed 重現）
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  window.COG = { finishTest, rng, URL: APPS_SCRIPT_URL, CFG, jsonp, submit, flushQueue, queueLength, session, deviceId, phaseFromUrl, PHASE_LABEL, $, shuffle, fmtTime, funLogger };
})();
