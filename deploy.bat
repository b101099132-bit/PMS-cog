@echo off
REM ============================================================
REM  One-click deploy for PMS-cog ONLY (patient tablet app)
REM  Completely separate from the main system (PMS-csc):
REM    - its own Apps Script project  (appsscript-src\ in this folder)
REM    - its own GitHub repo / Pages  (this folder is the repo root)
REM  Usage: double-click this file.
REM  NOTE: keep this file ASCII-only and CRLF line endings.
REM ============================================================

REM ===== CONFIG =====
set "REPO_URL=https://github.com/b101099132-bit/PMS-cog.git"
set "ROOT=%~dp0"
set "APPSSCRIPT_DIR=%ROOT%appsscript-src"
REM Fill in after the first "clasp deploy" (see README): reuse it so /exec stays the same
set "DEPLOYMENT_ID=AKfycbw_yIN4D8wPIDcyTtp941ZZ9Y0eqpYsEDH_9nSoP7g6m49vNyvRulLNY_ZVGki4w6C2kw"
REM ==================

echo.
echo === [1/3] Apps Script (PMS-cog project) ===
if not exist "%APPSSCRIPT_DIR%\.clasp.json" (
  echo SKIP: appsscript-src\.clasp.json not found. Run the one-time clasp setup in README first.
) else (
  cd /d "%APPSSCRIPT_DIR%" || (echo ERROR: folder not found & pause & exit /b 1)
  call clasp push -f || (echo ERROR: clasp push failed & pause & exit /b 1)
  if "%DEPLOYMENT_ID%"=="" (
    echo NOTE: DEPLOYMENT_ID is empty - code pushed but NOT deployed.
    echo       First time: run "clasp deploy -d PMS-cog" once, copy the ID into this file.
  ) else (
    call clasp deploy -i "%DEPLOYMENT_ID%" -d "auto deploy" || (echo ERROR: clasp deploy failed & pause & exit /b 1)
    echo OK: Apps Script updated, /exec URL unchanged
  )
)

echo.
echo === [2/3] GitHub Pages (this folder) ===
cd /d "%ROOT%" || (echo ERROR: cannot cd to %ROOT% & pause & exit /b 1)
where git >nul 2>nul || (echo ERROR: git is not installed & pause & exit /b 1)
if not exist ".git" (
  echo First run: connecting this folder to GitHub...
  git init || (echo ERROR: git init failed & pause & exit /b 1)
  git branch -M main
  git remote add origin "%REPO_URL%"
)
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "update PMS-cog" || (echo ERROR: git commit failed - set git identity first & pause & exit /b 1)
) else (
  echo No changes to commit.
)
git push -u origin main || (echo ERROR: git push failed - is the repo created on github.com? & pause & exit /b 1)

echo.
echo === [3/3] Done ===
echo Site: https://b101099132-bit.github.io/PMS-cog/   (live in 1-2 minutes)
echo.
pause
