@echo off
setlocal
set "ROOT=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo AWH QA requires Node.js 20 or newer. Install Node locally, then run: npm run qa:full
  exit /b 1
)
node "%ROOT%scripts\qa\awh-local-qa.mjs" full
exit /b %errorlevel%
