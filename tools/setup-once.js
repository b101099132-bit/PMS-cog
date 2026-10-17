/* PMS-cog 一次性設定（在使用者的 Windows 電腦上，由 setup-once.bat 以 node 執行）
 * 做的事：
 *  1. 問試算表網址（或 ID）→ clasp create --parentId：在同一份試算表上建立「第二個」Apps Script 專案 PMS-cog
 *  2. clasp push → clasp deploy → 解析 Deployment ID → 寫進 deploy.bat 與 _shared/config.js（/exec 網址）
 *  3. 若電腦有 gh：gh repo create PMS-cog --public；否則印出手動步驟
 *  4. 印出「還要你親手做的一件事」：開編輯器執行 addCogSheets()（授權＋建表）
 * 可重複執行：已有 .clasp.json 就跳過 create；已有 DEPLOYMENT_ID 就沿用。
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'appsscript-src');
const CLASP_JSON = path.join(SRC, '.clasp.json');
const DEPLOY_BAT = path.join(ROOT, 'deploy.bat');
const CONFIG_JS = path.join(ROOT, '_shared', 'config.js');
const REPO = 'b101099132-bit/PMS-cog';

function ask(q) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); })); }
function run(cmd, cwd) {
  console.log('\n> ' + cmd);
  const r = spawnSync(cmd, { cwd: cwd || SRC, shell: true, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  if (r.status !== 0) throw new Error('指令失敗：' + cmd);
  return out;
}
function has(cmd) { try { execSync((process.platform === 'win32' ? 'where ' : 'which ') + cmd, { stdio: 'ignore' }); return true; } catch (e) { return false; } }
function readBatDeployId() { const m = fs.readFileSync(DEPLOY_BAT, 'utf8').match(/set "DEPLOYMENT_ID=([^"]*)"/); return m ? m[1] : ''; }
function writeBatDeployId(id) {
  let s = fs.readFileSync(DEPLOY_BAT, 'utf8');
  s = s.replace(/set "DEPLOYMENT_ID=[^"]*"/, 'set "DEPLOYMENT_ID=' + id + '"');
  if (!/\r\n/.test(s)) s = s.replace(/\n/g, '\r\n');   // 保持 CRLF
  fs.writeFileSync(DEPLOY_BAT, s);
}
function writeConfigUrl(url) {
  let s = fs.readFileSync(CONFIG_JS, 'utf8');
  s = s.replace(/APPS_SCRIPT_URL:\s*'[^']*'/, "APPS_SCRIPT_URL: '" + url + "'");
  fs.writeFileSync(CONFIG_JS, s);
}

(async () => {
  console.log('=== PMS-cog 一次性設定 ===');
  if (!has('clasp')) { console.log('找不到 clasp。請先 npm i -g @google/clasp 並 clasp login（主系統部署已在用，應該已安裝）。'); process.exit(1); }

  // 1. 建立綁定專案
  if (fs.existsSync(CLASP_JSON)) {
    console.log('已有 appsscript-src\\.clasp.json，跳過建立專案。');
  } else {
    let sheet = await ask('請貼上「手術病人管理系統」Google 試算表的網址或 ID：');
    const m = sheet.match(/\/d\/([A-Za-z0-9_-]{20,})/);
    sheet = m ? m[1] : sheet;
    if (!/^[A-Za-z0-9_-]{20,}$/.test(sheet)) { console.log('看起來不是試算表 ID，請重跑。'); process.exit(1); }
    // 用暫存資料夾 create，避免 clasp 把範本 .gs 蓋到 cog.js
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pmscog-'));
    try { run('clasp create --title "PMS-cog" --parentId ' + sheet + ' --rootDir .', tmp); }        // clasp v2
    catch (e) { run('clasp create --title "PMS-cog" --parent-id ' + sheet + ' --rootDir .', tmp); } // clasp v3 旗標名不同
    const created = JSON.parse(fs.readFileSync(path.join(tmp, '.clasp.json'), 'utf8'));
    created.rootDir = '';
    fs.writeFileSync(CLASP_JSON, JSON.stringify(created, null, 2));
    console.log('✓ 已建立綁定專案，Script ID = ' + created.scriptId);
  }

  // 2. push + deploy
  run('clasp push -f');
  let depId = readBatDeployId();
  if (depId) {
    run('clasp deploy -i ' + depId + ' -d "PMS-cog"');
  } else {
    const out = run('clasp deploy -d "PMS-cog"');
    const m = out.match(/-\s+(AKfyc[A-Za-z0-9_-]+)\s+@/) || out.match(/(AKfyc[A-Za-z0-9_-]{30,})/);
    if (!m) { console.log('無法從輸出解析 Deployment ID，請手動把它填進 deploy.bat 的 DEPLOYMENT_ID。'); }
    else { depId = m[1]; writeBatDeployId(depId); console.log('✓ Deployment ID 已寫入 deploy.bat：' + depId); }
  }
  if (depId) {
    const url = 'https://script.google.com/macros/s/' + depId + '/exec';
    writeConfigUrl(url);
    console.log('✓ /exec 網址已寫入 _shared\\config.js：' + url);
  }

  // 3. GitHub repo
  if (has('gh')) {
    const r = spawnSync('gh repo view ' + REPO, { shell: true, encoding: 'utf8' });
    if (r.status === 0) console.log('GitHub repo ' + REPO + ' 已存在。');
    else { try { run('gh repo create ' + REPO + ' --public', ROOT); console.log('✓ 已建立 GitHub repo ' + REPO); } catch (e) { console.log('gh 建 repo 失敗，請手動到 https://github.com/new 建立 Public 空 repo「PMS-cog」。'); } }
  } else {
    console.log('\n電腦沒有 gh 指令：請手動到 https://github.com/new 建立 Public、空的 repo「PMS-cog」（不要勾 README）。');
  }

  // 4. 提醒
  const sid = JSON.parse(fs.readFileSync(CLASP_JSON, 'utf8')).scriptId;
  console.log('\n=== 還需要你親手做一次（Google 授權只能由你本人在瀏覽器完成） ===');
  console.log('1. 開啟 https://script.google.com/home/projects/' + sid + '/edit');
  console.log('   上方函式下拉選 addCogSheets → 執行 → 同意授權（試算表、Drive、外部連線）→ 執行紀錄看到「✓ addCogSheets 完成」');
  console.log('2. 回到這個資料夾雙擊 deploy.bat（第一次會 git init 並上傳）→ GitHub repo Settings → Pages → main /(root) → Save');
  console.log('3. 之後每次改檔只要雙擊 deploy.bat。');
})().catch(e => { console.error('\n✗ ' + e.message); process.exit(1); });
