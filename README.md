# PMS-cog — 病人平板（康復小幫手）

心臟手術病人住院期間專用 iPad 網頁：恢復狀況問卷 QoR-15C、三個認知測驗、EQ-5D、休閒遊戲；護理師端：平板綁定、Mini-Cog 施測。
**與主系統 PMS-csc 完全分開**：自己的 GitHub repo／Pages、自己的 Apps Script 專案與 /exec 網址、自己的 `deploy.bat`。
唯一共用的是同一份 Google 試算表 —— 本系統只「讀」病人主檔（找病人、手術日），只「寫」自己新增的六張工作表。

網址（部署後）：https://b101099132-bit.github.io/PMS-cog/
- 病人入口 `index.html` → 依時點列出今天該做的項目 ＋「玩遊戲」
- 工作人員 `staff/bind.html` → 綁定／解除平板、指定時點（頁面右下角小字「工作人員」也能進）

## 資料夾

```
PMS-cog\                     ← git repo 根目錄（GitHub Pages 直接發布這裡）
├─ index.html                病人入口
├─ qor15.html                恢復狀況問卷 QoR-15C
├─ fun\                      休閒遊戲（翻翻樂 match、連連看 onet、數字排排站 slide）
├─ staff\bind.html           護理師：綁定平板
├─ _shared\
│   ├─ config.js             ★ 貼 PMS-cog 自己的 Apps Script /exec 網址
│   ├─ core.js               連線、綁定狀態、離線排隊
│   └─ pms.css               樣式（沿用主系統視覺，字級放大）
├─ tests\                    認知測驗（圖樣記憶 memory、買菜 groceries、接線 lines）
├─ eq5d.html                 健康狀況問卷 EQ-5D-5L（暫行措辭，正式前換 EuroQol 授權文字）
├─ staff\minicog.html        護理師：Mini-Cog 施測紀錄＋畫時鐘畫布（PNG 存 Drive）
├─ tools\setup-once.js       一次性設定腳本（由 setup-once.bat 呼叫）
├─ setup-once.bat            一次性設定
├─ appsscript-src\
│   ├─ cog.js                後端（綁在同一份試算表的第二個 Apps Script 專案）
│   ├─ appsscript.json
│   └─ .clasp.json           clasp 產生，不上傳（.gitignore）
├─ deploy.bat                一鍵部署（只動 PMS-cog）
└─ README.md
```

## 一次性設定（兩個步驟）

### 1. 雙擊 `setup-once.bat`
會問你一次「手術病人管理系統」試算表的網址，然後自動：
- 用 clasp 在**同一份試算表**上建立第二個 Apps Script 專案 `PMS-cog`（主系統的專案完全不動）
- `clasp push` + `clasp deploy`，把 Deployment ID 寫進 `deploy.bat`、把 /exec 網址寫進 `_shared/config.js`
- 若電腦有 `gh` 指令就順便建 GitHub repo `PMS-cog`；沒有就提示你到 https://github.com/new 建一個 Public 空 repo（不勾 README）

前提：電腦已有 node、clasp 且 `clasp login` 過（主系統部署在用的那套）。

### 2. 在瀏覽器授權一次（只能本人做）
setup 結束會印出編輯器網址。打開 → 上方函式選 `addCogSheets` → 執行 → 同意授權（試算表、Drive、連線外部服務）→ 執行紀錄看到「✓ addCogSheets 完成」。
這一步同時建立六張工作表：平板綁定、QoR15、認知測驗、EQ5D、休閒遊玩、MiniCog。

然後雙擊 `deploy.bat`（第一次會 git init 並上傳）→ GitHub repo → Settings → Pages → Branch `main`、`/ (root)` → Save。1–2 分鐘後網址可用。

通行碼：PMS-cog 不另存密碼，護理師在綁定頁輸入的通行碼會丟給**主系統**的 `action=role` 驗證（只讀），所以直接用現有的團隊碼即可。

## 日常流程
改檔 → 雙擊 `deploy.bat`。只會推 PMS-cog 的 Apps Script 與 repo，不會碰主系統。

## iPad 設定
1. Safari 開 https://b101099132-bit.github.io/PMS-cog/ → 分享 → 加入主畫面（名稱「康復小幫手」）。
2. 護理師：點右下角「工作人員」→ 輸入團隊通行碼（勾記住）→ 搜尋病人 → 綁定 → 回首頁交給病人。
3. 設定 → 輔助使用 → 引導使用模式：開啟後在 App 內連按三下側邊鍵鎖定，病人就不能切到其他 App。
4. 網路：手機熱點即可；斷線時填寫的資料會先存在平板，恢復連線自動補送（首頁會顯示待上傳筆數）。
5. 出院：工作人員頁 → 解除綁定 → 平板可直接給下一位。

## 時點規則
手術日（實際手術日優先，否則預定日）：手術前＝T0；POD1–2＝T1；POD3–4＝T2；POD5 起＝T3。
護理師可在綁定頁手動指定（例如 POD1 病人還不能配合）。各時點項目定義在 `index.html` 的 `PLAN`。
