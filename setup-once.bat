@echo off
REM ============================================================
REM  PMS-cog ONE-TIME setup (run once, double-click)
REM  Creates the PMS-cog Apps Script project bound to the same spreadsheet,
REM  pushes + deploys it, writes the /exec URL into _shared\config.js and the
REM  Deployment ID into deploy.bat, and creates the GitHub repo if "gh" exists.
REM  Needs: node + clasp already logged in (same as the main system).
REM  NOTE: keep this file ASCII-only and CRLF line endings.
REM ============================================================
cd /d "%~dp0" || (echo ERROR: cannot cd & pause & exit /b 1)
where node >nul 2>nul || (echo ERROR: node is not installed & pause & exit /b 1)
node tools\setup-once.js
echo.
pause
