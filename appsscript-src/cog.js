/**
 * ============================================================
 *  PMS-cog — 病人平板（QoR-15C／認知測驗／EQ-5D／休閒遊戲／Mini-Cog）後端
 *  2026-10-17。與主系統（PMS-csc 的 程式碼.js）完全分開：
 *    - 這是「同一份 Google 試算表」上的另一個綁定 Apps Script 專案，有自己的 /exec 網址與部署
 *    - 只「讀」病人主檔（找病人、手術日），只「寫」自己的六張工作表；不碰主系統任何欄位
 *    - 通行碼借用主系統驗證（只呼叫主系統 action=role），護理師用同一組團隊碼
 *
 *  GET（JSONP）：
 *    action=role           key                      → 驗通行碼
 *    action=searchPatients key, q                   → 姓名搜尋病人主檔（只回傳綁定需要的欄位）
 *    action=bindTablet     key, pk, device          → 綁定平板，回傳 token
 *    action=unbindTablet   key, token               → 解除綁定
 *    action=listTablets    key                      → 使用中的綁定清單
 *    action=setPhase       key, token, phase        → 護理師手動指定時點（T0–T3，空＝自動）
 *    action=lookupTablet   token                    → 病人今日時點 + 已完成項目
 *
 *  POST（FormData，no-cors）：
 *    action=submitQor15    token, phase, q1..q15, filler, seconds, device
 *    action=submitTest     token, phase, test, score, metrics(JSON), seconds, device
 *    action=submitEq5d     token, phase, mo, sc, ua, pd, ad, vas, device
 *    action=logFun         token, game, rounds, minutes, device
 *    action=submitMiniCog  key, pk, wordVersion, recall, clock, total, clockPng(base64), examiner, note
 *
 *  一次性：部署後在編輯器執行 addCogSheets()（建六張工作表＋完成授權，可重複執行）。
 *  通行碼：預設借用主系統（action=role 驗證），不必另設。
 * ============================================================
 */

// ---------- 試算表 ----------
//  本專案以 clasp create --parentId <試算表ID> 建成「綁定在同一份試算表上的第二個 Apps Script 專案」，
//  所以直接 getActiveSpreadsheet()；若日後改成獨立專案，設指令碼屬性 SPREADSHEET_ID 即可。
function cogSS() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

// ---------- 病人主檔（只讀；欄位位置與主系統 PT 常數一致） ----------
const COG_SHEET_PATIENTS = '病人主檔';
const COG_PT = { pk: 1, name: 3, gender: 4, age: 6, diagnosis: 27, scheduled: 28, surgeryMain: 29, surgeryOther: 30, status: 33, actualDate: 34 };

// ---------- 通行碼 ----------
//  預設「借用主系統的通行碼」：把 key 丟給主系統 /exec 的 action=role 驗證（只讀、不寫任何東西），
//  護理師就用同一組團隊碼，本專案不必另存密碼。若本專案指令碼屬性有 ADMIN_KEY／TEAM_KEY 則優先用自己的。
const COG_MAIN_EXEC = 'https://script.google.com/macros/s/AKfycbzr5eDnHyyq2hWZJ1pD4x5z7h8LkabeZMNDcl6o1lWx0e3bE4CLDCkmqYCzPA1qagU2ug/exec';
const COG_ADMIN_KEY = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
const COG_TEAM_KEY = PropertiesService.getScriptProperties().getProperty('TEAM_KEY') || '';
function cogRoleOf(key) {
  key = String(key || '');
  if (!key) return null;
  if (COG_ADMIN_KEY || COG_TEAM_KEY) {
    if (COG_ADMIN_KEY && key === COG_ADMIN_KEY) return 'admin';
    if (COG_TEAM_KEY && key === COG_TEAM_KEY) return 'team';
    return null;
  }
  // 借用主系統驗證；結果快取 10 分鐘，減少對主系統的呼叫
  const cache = CacheService.getScriptCache();
  const ck = 'role_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key)).slice(0, 40);
  const hit = cache.get(ck);
  if (hit) return hit === '-' ? null : hit;
  let role = null;
  try {
    const res = UrlFetchApp.fetch(COG_MAIN_EXEC + '?action=role&callback=cb&key=' + encodeURIComponent(key), { muteHttpExceptions: true, followRedirects: true });
    const m = res.getContentText().match(/"role":"(admin|team)"/);
    role = m ? m[1] : null;
  } catch (err) { console.error('cogRoleOf fetch:', err); }
  cache.put(ck, role || '-', 600);
  return role;
}
function cogStaff(p) {
  const r = cogRoleOf(p && p.key);
  if (!r) Utilities.sleep(1500);   // 錯誤通行碼刻意延遲
  return r;
}
/* 選用：若不想借用主系統驗證，可在這裡設定本專案自己的通行碼（與主系統不同）；平常不需要執行 */
function setupCogKeys() {
  const ADMIN = '';   // ← 要沿用主系統的管理員碼就貼在這裡（執行後可清掉）
  const TEAM = '';    // ← 要沿用主系統的團隊碼就貼在這裡
  const gen = () => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; let k = ''; const b = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); for (let i = 0; i < 16; i++) k += chars[parseInt(b.substr(i * 2, 2), 16) % chars.length]; return k; };
  const props = PropertiesService.getScriptProperties();
  const a = ADMIN || props.getProperty('ADMIN_KEY') || gen();
  const t = TEAM || props.getProperty('TEAM_KEY') || gen();
  props.setProperty('ADMIN_KEY', a); props.setProperty('TEAM_KEY', t);
  Logger.log('✓ ADMIN_KEY = ' + a + '\n✓ TEAM_KEY  = ' + t + '\n（設定後本專案不再借用主系統通行碼）');
}

// ---------- 工作表定義 ----------
const COG_SHEETS = {
  bind:    { name: '平板綁定',  headers: ['時間戳記', 'token', '病人PK', '姓名', '預定手術日', '裝置', '綁定時間', '解除時間', '狀態', '綁定者', '時點覆寫'] },
  qor15:   { name: 'QoR15',     headers: ['時間戳記', 'token', '病人PK', '時點', 'Q1呼吸', 'Q2食欲', 'Q3精力', 'Q4睡眠', 'Q5自理', 'Q6溝通', 'Q7支持', 'Q8日常', 'Q9情緒', 'Q10好轉', 'Q11中度疼痛', 'Q12劇烈疼痛', 'Q13噁心嘔吐', 'Q14焦慮', 'Q15低落', 'A小計', 'B小計', '總分', '填寫秒數', '填寫者', '裝置'] },
  test:    { name: '認知測驗',  headers: ['時間戳記', 'token', '病人PK', '時點', '測驗', '分數', '原始指標JSON', '用時秒', '裝置'] },
  eq5d:    { name: 'EQ5D',      headers: ['時間戳記', 'token', '病人PK', '時點', '行動', '自我照顧', '日常活動', '疼痛不適', '焦慮憂鬱', 'VAS', '裝置'] },
  fun:     { name: '休閒遊玩',  headers: ['時間戳記', 'token', '病人PK', '遊戲', '局數', '分鐘', '裝置'] },
  minicog: { name: 'MiniCog',   headers: ['時間戳記', '病人PK', '姓名', '名詞版本', '三詞回憶', '畫時鐘', '總分', '時鐘圖連結', '施測者', '備註'] },
};
const COG_BIND = { ts: 1, token: 2, pk: 3, name: 4, scheduled: 5, device: 6, bindTime: 7, unbindTime: 8, status: 9, binder: 10, phaseOverride: 11 };
const COG_STATUS_ACTIVE = '使用中';
const COG_STATUS_DONE = '已解除';
const COG_DRIVE_FOLDER = 'PMS-cog MiniCog 畫時鐘';
const COG_TZ = 'Asia/Taipei';

// ---------- 路由 ----------
function doGet(e) {
  const p = (e && e.parameter) || {};
  const a = p.action;
  if (a === 'role') return handleCogRole(e);
  if (a === 'searchPatients') return handleCogSearchPatients(e);
  if (a === 'bindTablet') return handleBindTablet(e);
  if (a === 'unbindTablet') return handleUnbindTablet(e);
  if (a === 'listTablets') return handleListTablets(e);
  if (a === 'setPhase') return handleSetPhase(e);
  if (a === 'lookupTablet') return handleLookupTablet(e);
  if (a === 'diag') return handleCogDiag(e);
  if (a === 'patientResults') return handlePatientResults(e);
  return ContentService.createTextOutput('PMS-cog backend is running.').setMimeType(ContentService.MimeType.TEXT);
}
function doPost(e) {
  if (!e) return ContentService.createTextOutput('doPost 需由實際 HTTP POST 觸發。').setMimeType(ContentService.MimeType.TEXT);
  const a = (e.parameter || {}).action;
  if (a === 'submitQor15') return handleSubmitQor15(e);
  if (a === 'submitTest') return handleSubmitTest(e);
  if (a === 'submitEq5d') return handleSubmitEq5d(e);
  if (a === 'logFun') return handleLogFun(e);
  if (a === 'submitMiniCog') return handleSubmitMiniCog(e);
  return jsonResponse({ status: 'error', message: 'unknown action' });
}
function jsonResponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function jsonpResponse(callback, obj) {
  const safe = String(callback || 'callback').replace(/[^a-zA-Z0-9_$]/g, '');
  return ContentService.createTextOutput(safe + '(' + JSON.stringify(obj) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function maskName(name) {
  const t = String(name == null ? '' : name).trim();
  if (t.length <= 1) return t;
  if (t.length === 2) return t[0] + '*';
  return t[0] + '*' + t[t.length - 1];
}
function fmtD(v) { return v ? Utilities.formatDate(new Date(v), COG_TZ, 'yyyy-MM-dd') : ''; }

// ---------- 一次性：建表 ----------
function addCogSheets() {
  const ss = cogSS();
  Object.keys(COG_SHEETS).forEach(k => {
    const def = COG_SHEETS[k];
    let sh = ss.getSheetByName(def.name);
    if (!sh) { sh = ss.insertSheet(def.name); Logger.log('新增工作表：' + def.name); }
    const have = sh.getLastColumn();
    const cur = have ? sh.getRange(1, 1, 1, have).getValues()[0].map(String) : [];
    def.headers.forEach((h, i) => { if (cur[i] !== h) sh.getRange(1, i + 1).setValue(h); });
    sh.getRange(1, 1, 1, def.headers.length).setFontWeight('bold').setBackground('#E6EDED');
    sh.setFrozenRows(1);
  });
  Logger.log('✓ addCogSheets 完成');
}
function cogSheet(k) {
  const sh = cogSS().getSheetByName(COG_SHEETS[k].name);
  if (!sh) throw new Error('找不到工作表：' + COG_SHEETS[k].name + '（請先執行 addCogSheets）');
  return sh;
}
function cogAppend(k, obj) {
  const sh = cogSheet(k);
  const row = COG_SHEETS[k].headers.map(h => (h === '時間戳記') ? new Date() : (obj[h] !== undefined ? obj[h] : ''));
  sh.appendRow(row);
  return sh.getLastRow();
}

// ---------- 病人主檔（只讀） ----------
function cogPatientRows() {
  const sh = cogSS().getSheetByName(COG_SHEET_PATIENTS);
  if (!sh) throw new Error('找不到工作表：' + COG_SHEET_PATIENTS);
  const n = sh.getLastRow() - 2;          // 主系統病人主檔表頭佔 2 列，資料自第 3 列
  if (n <= 0) return [];
  return sh.getRange(3, 1, n, COG_PT.actualDate).getValues();
}
function cogPatient(pk) {
  if (!pk) return null;
  const rows = cogPatientRows();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[COG_PT.pk - 1]) === String(pk)) {
      const main = r[COG_PT.surgeryMain - 1], other = r[COG_PT.surgeryOther - 1];
      return { pk: r[0], name: r[COG_PT.name - 1], gender: r[COG_PT.gender - 1], age: r[COG_PT.age - 1],
        scheduledDate: fmtD(r[COG_PT.scheduled - 1]), actualDate: fmtD(r[COG_PT.actualDate - 1]),
        status: r[COG_PT.status - 1] || '', surgery: main === '其他' ? (other || '其他') : (main || '') };
    }
  }
  return null;
}
/* 工作人員：一位病人在各時點的所有結果 ?action=patientResults&key=&pk= */
function handlePatientResults(e) {
  const p = e.parameter || {};
  try {
    if (!cogStaff(p)) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const pk = String(p.pk || '').trim();
    if (!pk) return jsonpResponse(p.callback, { error: '缺少病人主鍵' });
    const pt = cogPatient(pk) || {};
    const fmt = v => v ? Utilities.formatDate(new Date(v), COG_TZ, 'yyyy-MM-dd HH:mm') : '';
    const rowsOf = (k, pkCol) => {
      const sh = cogSheet(k); const n = sh.getLastRow() - 1; if (n <= 0) return [];
      const h = COG_SHEETS[k].headers;
      return sh.getRange(2, 1, n, h.length).getValues().filter(r => String(r[pkCol]) === pk).map(r => { const o = {}; h.forEach((name, i) => o[name] = (name === '時間戳記') ? fmt(r[i]) : r[i]); return o; });
    };
    const out = {
      ok: true, name: pt.name || '', surgeryDate: pt.actualDate || pt.scheduledDate || '', surgery: pt.surgery || '', status: pt.status || '',
      qor15: rowsOf('qor15', 2), tests: rowsOf('test', 2).map(o => { delete o['原始指標JSON']; return o; }), eq5d: rowsOf('eq5d', 2),
      fun: rowsOf('fun', 2), minicog: rowsOf('minicog', 1), binds: rowsOf('bind', 2).map(o => { delete o.token; return o; }),
    };
    try {   // 主系統滿意度問卷（若已加「病人PK」欄）
      const sv = cogSS().getSheetByName('滿意度問卷');
      if (sv && sv.getLastRow() > 1) {
        const hdr = sv.getRange(1, 1, 1, sv.getLastColumn()).getValues()[0].map(String);
        const c = hdr.indexOf('病人PK'), t = hdr.indexOf('時間戳記'), o = hdr.indexOf('整體滿意度');
        if (c >= 0) out.prems = sv.getRange(2, 1, sv.getLastRow() - 1, hdr.length).getValues().filter(r => String(r[c]) === pk).map(r => ({ '時間戳記': fmt(r[t]), '整體滿意度': o >= 0 ? r[o] : '' }));
      }
    } catch (ignore) {}
    return jsonpResponse(p.callback, out);
  } catch (err) { console.error('handlePatientResults:', err); return jsonpResponse(p.callback, { error: err.message }); }
}
/* 診斷：?action=diag&key=通行碼&callback=cb → 目前綁到哪份試算表、有哪些分頁 */
function handleCogDiag(e) {
  const p = e.parameter || {};
  try {
    if (!cogStaff(p)) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const ss = cogSS();
    return jsonpResponse(p.callback, { spreadsheetName: ss.getName(), spreadsheetId: ss.getId(), url: ss.getUrl(),
      sheets: ss.getSheets().map(sh => sh.getName()), usingProperty: !!PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
      hasPatients: !!ss.getSheetByName(COG_SHEET_PATIENTS) });
  } catch (err) { return jsonpResponse(p.callback, { error: err.message }); }
}
function handleCogRole(e) {
  const p = e.parameter || {};
  const r = cogRoleOf(p.key);
  if (!r) Utilities.sleep(1500);
  return jsonpResponse(p.callback, { role: r || null });
}
function handleCogSearchPatients(e) {
  const p = e.parameter || {};
  try {
    if (!cogStaff(p)) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const q = String(p.q || '').trim();
    if (!q) return jsonpResponse(p.callback, { list: [], count: 0 });
    const list = [];
    cogPatientRows().forEach(r => {
      if (!r[0] || !r[COG_PT.name - 1]) return;
      if (String(r[COG_PT.name - 1]).indexOf(q) < 0) return;
      const main = r[COG_PT.surgeryMain - 1], other = r[COG_PT.surgeryOther - 1];
      list.push({ pk: r[0], name: r[COG_PT.name - 1], gender: r[COG_PT.gender - 1], age: r[COG_PT.age - 1],
        createdDate: fmtD(r[1]), scheduledDate: fmtD(r[COG_PT.scheduled - 1]), surgeryStatus: r[COG_PT.status - 1] || '',
        surgery: main === '其他' ? (other || '其他') : (main || '') });
    });
    list.sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
    return jsonpResponse(p.callback, { list: list.slice(0, 50), count: list.length });
  } catch (err) { console.error('handleCogSearchPatients:', err); return jsonpResponse(p.callback, { error: err.message }); }
}

// ---------- 綁定 ----------
function cogToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  let k = '';
  for (let i = 0; i < 20; i++) k += chars[parseInt(b.substr(i * 2, 2), 16) % chars.length];
  return k;
}
function cogBindRows() {
  const sh = cogSheet('bind');
  const n = sh.getLastRow() - 1;
  if (n <= 0) return { sh: sh, rows: [] };
  const vals = sh.getRange(2, 1, n, COG_SHEETS.bind.headers.length).getValues();
  return { sh: sh, rows: vals.map((r, i) => ({ rowNum: i + 2, v: r })) };
}
function cogFindActiveByToken(token) {
  if (!token) return null;
  const d = cogBindRows();
  for (let i = d.rows.length - 1; i >= 0; i--) {
    const r = d.rows[i];
    if (String(r.v[COG_BIND.token - 1]) === String(token) && r.v[COG_BIND.status - 1] === COG_STATUS_ACTIVE) return r;
  }
  return null;
}
function cogRevoke(sh, rowNum) {
  sh.getRange(rowNum, COG_BIND.status).setValue(COG_STATUS_DONE);
  sh.getRange(rowNum, COG_BIND.unbindTime).setValue(new Date());
}

function handleBindTablet(e) {
  const p = e.parameter || {};
  try {
    const role = cogStaff(p);
    if (!role) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const pk = String(p.pk || '').trim();
    if (!pk) return jsonpResponse(p.callback, { error: '缺少病人主鍵' });
    const pt = cogPatient(pk);
    if (!pt) return jsonpResponse(p.callback, { error: '找不到病人' });
    const device = String(p.device || '').trim();
    const d = cogBindRows();   // 一人一台、一台一人：舊綁定先解除
    d.rows.forEach(r => {
      if (r.v[COG_BIND.status - 1] !== COG_STATUS_ACTIVE) return;
      if (String(r.v[COG_BIND.pk - 1]) === pk || (device && String(r.v[COG_BIND.device - 1]) === device)) cogRevoke(d.sh, r.rowNum);
    });
    const token = cogToken();
    cogAppend('bind', { token: token, '病人PK': pk, '姓名': pt.name || '', '預定手術日': pt.scheduledDate, '裝置': device,
      '綁定時間': new Date(), '狀態': COG_STATUS_ACTIVE, '綁定者': role, '時點覆寫': '' });
    return jsonpResponse(p.callback, { ok: true, token: token, name: maskName(pt.name), scheduledDate: pt.scheduledDate, surgeryStatus: pt.status });
  } catch (err) { console.error('handleBindTablet:', err); return jsonpResponse(p.callback, { error: err.message }); }
}
function handleUnbindTablet(e) {
  const p = e.parameter || {};
  try {
    if (!cogStaff(p)) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const token = String(p.token || '').trim();
    if (!token) return jsonpResponse(p.callback, { error: '缺少 token' });
    const r = cogFindActiveByToken(token);
    if (!r) return jsonpResponse(p.callback, { ok: true, already: true });
    cogRevoke(cogSheet('bind'), r.rowNum);
    return jsonpResponse(p.callback, { ok: true });
  } catch (err) { console.error('handleUnbindTablet:', err); return jsonpResponse(p.callback, { error: err.message }); }
}
function handleListTablets(e) {
  const p = e.parameter || {};
  try {
    if (!cogStaff(p)) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const fmt = v => v ? Utilities.formatDate(new Date(v), COG_TZ, 'yyyy-MM-dd HH:mm') : '';
    const list = cogBindRows().rows.filter(r => r.v[COG_BIND.status - 1] === COG_STATUS_ACTIVE).map(r => ({
      token: r.v[COG_BIND.token - 1], pk: r.v[COG_BIND.pk - 1], name: maskName(r.v[COG_BIND.name - 1]),
      scheduledDate: fmtD(r.v[COG_BIND.scheduled - 1]), device: r.v[COG_BIND.device - 1],
      bindTime: fmt(r.v[COG_BIND.bindTime - 1]), phaseOverride: r.v[COG_BIND.phaseOverride - 1] || '' }));
    return jsonpResponse(p.callback, { list: list });
  } catch (err) { console.error('handleListTablets:', err); return jsonpResponse(p.callback, { error: err.message }); }
}
function handleSetPhase(e) {
  const p = e.parameter || {};
  try {
    if (!cogStaff(p)) return jsonpResponse(p.callback, { error: 'unauthorized' });
    const r = cogFindActiveByToken(String(p.token || ''));
    if (!r) return jsonpResponse(p.callback, { error: '此平板目前沒有綁定' });
    const ph = String(p.phase || '').toUpperCase();
    const val = ['T0', 'T1', 'T2', 'T3'].indexOf(ph) >= 0 ? ph : '';
    cogSheet('bind').getRange(r.rowNum, COG_BIND.phaseOverride).setValue(val);
    return jsonpResponse(p.callback, { ok: true, phaseOverride: val });
  } catch (err) { console.error('handleSetPhase:', err); return jsonpResponse(p.callback, { error: err.message }); }
}

// ---------- 時點判定 ----------
//  手術日 = 實際手術日 優先，否則預定手術日。T0：手術日前（含當天）或無手術日；T1：POD1–2；T2：POD3–4；T3：POD5 起
function cogPhaseOf(surgeryDate, override) {
  if (override) return { phase: override, pod: null, auto: false };
  if (!surgeryDate) return { phase: 'T0', pod: null, auto: true };
  const d0 = new Date(fmtD(surgeryDate) + 'T00:00:00+08:00');
  const now = new Date(Utilities.formatDate(new Date(), COG_TZ, 'yyyy-MM-dd') + 'T00:00:00+08:00');
  const pod = Math.round((now - d0) / 86400000);
  let phase = 'T0';
  if (pod >= 1 && pod <= 2) phase = 'T1';
  else if (pod >= 3 && pod <= 4) phase = 'T2';
  else if (pod >= 5) phase = 'T3';
  return { phase: phase, pod: pod, auto: true };
}
function cogDoneFor(token, phase, pk) {
  const done = { qor15: false, eq5d: false, tests: {}, prems: false };
  // 照護經驗問卷（主系統「滿意度問卷」表）：有這位病人主鍵的紀錄即視為已填
  try {
    if (pk) {
      const sv = cogSS().getSheetByName('滿意度問卷');
      if (sv && sv.getLastRow() > 1) {
        const hdr = sv.getRange(1, 1, 1, sv.getLastColumn()).getValues()[0].map(String);
        const c = hdr.indexOf('病人PK');
        if (c >= 0) done.prems = sv.getRange(2, c + 1, sv.getLastRow() - 1, 1).getValues().some(r => String(r[0]) === String(pk));
      }
    }
  } catch (ignore) {}
  const scan = (k, fn) => {
    const sh = cogSheet(k);
    const n = sh.getLastRow() - 1;
    if (n <= 0) return;
    sh.getRange(2, 1, n, COG_SHEETS[k].headers.length).getValues().forEach(r => { if (String(r[1]) === String(token) && String(r[3]) === phase) fn(r); });
  };
  scan('qor15', () => { done.qor15 = true; });
  scan('eq5d', () => { done.eq5d = true; });
  scan('test', r => { done.tests[String(r[4])] = true; });
  return done;
}
function handleLookupTablet(e) {
  const p = e.parameter || {};
  try {
    const token = String(p.token || '').trim();
    const r = cogFindActiveByToken(token);
    if (!r) return jsonpResponse(p.callback, { ok: false, reason: 'unbound' });
    const pt = cogPatient(r.v[COG_BIND.pk - 1]) || {};
    const surgeryDate = pt.actualDate || pt.scheduledDate || fmtD(r.v[COG_BIND.scheduled - 1]);
    const ph = cogPhaseOf(surgeryDate, r.v[COG_BIND.phaseOverride - 1] || '');
    const out = { ok: true, name: maskName(pt.name || r.v[COG_BIND.name - 1]), surgeryDate: surgeryDate,
      surgeryStatus: pt.status || '', phase: ph.phase, pod: ph.pod, autoPhase: ph.auto, done: cogDoneFor(token, ph.phase, pt.pk || r.v[COG_BIND.pk - 1]),
      pk: pt.pk || r.v[COG_BIND.pk - 1],   // 病人主鍵（token 本身即該病人專屬，回傳供主系統 PREMs 問卷帶入 ?pk=）
      today: Utilities.formatDate(new Date(), COG_TZ, 'yyyy-MM-dd') };
    if (p.key && cogRoleOf(p.key)) { out.fullName = pt.name || ''; out.gender = pt.gender || ''; out.age = pt.age || ''; }   // 工作人員附通行碼時才回傳主鍵
    return jsonpResponse(p.callback, out);
  } catch (err) { console.error('handleLookupTablet:', err); return jsonpResponse(p.callback, { error: err.message }); }
}

// ---------- 病人端送出（只驗 token） ----------
function cogRequireToken(p) {
  const r = cogFindActiveByToken(String(p.token || '').trim());
  if (!r) throw new Error('token 無效或已解除綁定');
  return { token: String(p.token).trim(), pk: r.v[COG_BIND.pk - 1] };
}
function cogNum(v) { const n = parseFloat(v); return isNaN(n) ? '' : n; }
function handleSubmitQor15(e) {
  try {
    const p = e.parameter || {};
    const t = cogRequireToken(p);
    const q = [];
    for (let i = 1; i <= 15; i++) q.push(cogNum(p['q' + i]));
    const sum = arr => arr.reduce((s, v) => s + (v === '' ? 0 : v), 0);
    const sumA = sum(q.slice(0, 10)), sumB = sum(q.slice(10));
    const h = COG_SHEETS.qor15.headers;
    const obj = { token: t.token, '病人PK': t.pk, '時點': p.phase || '', 'A小計': sumA, 'B小計': sumB, '總分': sumA + sumB,
      '填寫秒數': cogNum(p.seconds), '填寫者': p.filler || '', '裝置': p.device || '' };
    for (let i = 0; i < 15; i++) obj[h[4 + i]] = q[i];
    return jsonResponse({ status: 'success', row: cogAppend('qor15', obj), total: sumA + sumB });
  } catch (err) { console.error('handleSubmitQor15:', err); return jsonResponse({ status: 'error', message: err.message }); }
}
function handleSubmitTest(e) {
  try {
    const p = e.parameter || {};
    const t = cogRequireToken(p);
    const row = cogAppend('test', { token: t.token, '病人PK': t.pk, '時點': p.phase || '', '測驗': p.test || '', '分數': cogNum(p.score),
      '原始指標JSON': String(p.metrics || '').slice(0, 45000), '用時秒': cogNum(p.seconds), '裝置': p.device || '' });
    return jsonResponse({ status: 'success', row: row });
  } catch (err) { console.error('handleSubmitTest:', err); return jsonResponse({ status: 'error', message: err.message }); }
}
function handleSubmitEq5d(e) {
  try {
    const p = e.parameter || {};
    const t = cogRequireToken(p);
    const row = cogAppend('eq5d', { token: t.token, '病人PK': t.pk, '時點': p.phase || '', '行動': cogNum(p.mo), '自我照顧': cogNum(p.sc),
      '日常活動': cogNum(p.ua), '疼痛不適': cogNum(p.pd), '焦慮憂鬱': cogNum(p.ad), 'VAS': cogNum(p.vas), '裝置': p.device || '' });
    return jsonResponse({ status: 'success', row: row });
  } catch (err) { console.error('handleSubmitEq5d:', err); return jsonResponse({ status: 'error', message: err.message }); }
}
function handleLogFun(e) {
  try {
    const p = e.parameter || {};
    const t = cogRequireToken(p);
    const row = cogAppend('fun', { token: t.token, '病人PK': t.pk, '遊戲': p.game || '', '局數': cogNum(p.rounds), '分鐘': cogNum(p.minutes), '裝置': p.device || '' });
    return jsonResponse({ status: 'success', row: row });
  } catch (err) { console.error('handleLogFun:', err); return jsonResponse({ status: 'error', message: err.message }); }
}

// ---------- Mini-Cog（護理師端） ----------
function cogDriveFolder() {
  const it = DriveApp.getFoldersByName(COG_DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(COG_DRIVE_FOLDER);
}
function handleSubmitMiniCog(e) {
  try {
    const p = e.parameter || {};
    if (!cogStaff(p)) return jsonResponse({ status: 'error', message: 'unauthorized' });
    const pk = String(p.pk || '').trim();
    if (!pk) return jsonResponse({ status: 'error', message: '缺少病人主鍵' });
    const pt = cogPatient(pk) || {};
    let link = '';
    if (p.clockPng) {
      try {
        const b64 = String(p.clockPng).replace(/^data:image\/png;base64,/, '');
        const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'minicog_' + pk + '_' + Utilities.formatDate(new Date(), COG_TZ, 'yyyyMMdd_HHmm') + '.png');
        link = cogDriveFolder().createFile(blob).getUrl();
      } catch (err2) { link = '（圖檔儲存失敗：' + err2.message + '）'; }
    }
    const row = cogAppend('minicog', { '病人PK': pk, '姓名': pt.name || '', '名詞版本': p.wordVersion || '', '三詞回憶': cogNum(p.recall),
      '畫時鐘': cogNum(p.clock), '總分': cogNum(p.total), '時鐘圖連結': link, '施測者': p.examiner || '', '備註': p.note || '' });
    return jsonResponse({ status: 'success', row: row, link: link });
  } catch (err) { console.error('handleSubmitMiniCog:', err); return jsonResponse({ status: 'error', message: err.message }); }
}

// ---------- 測試（編輯器手動執行） ----------
function testCogPhase() {
  const today = new Date();
  [-2, 0, 1, 2, 3, 4, 5, 9].forEach(off => {
    const d = new Date(today.getTime() + off * 86400000);
    Logger.log('手術日 ' + fmtD(d) + ' → ' + JSON.stringify(cogPhaseOf(d, '')));
  });
}
function testCogSearch() {
  const key = COG_TEAM_KEY || COG_ADMIN_KEY;
  Logger.log(handleCogSearchPatients({ parameter: { key: key, q: '測試', callback: 'cb' } }).getContent());
}
function testCogLookup() {
  const act = cogBindRows().rows.filter(r => r.v[COG_BIND.status - 1] === COG_STATUS_ACTIVE);
  if (!act.length) { Logger.log('目前沒有使用中的綁定'); return; }
  Logger.log(handleLookupTablet({ parameter: { token: act[act.length - 1].v[COG_BIND.token - 1], callback: 'cb' } }).getContent());
}
