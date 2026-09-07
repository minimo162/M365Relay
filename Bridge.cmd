@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Launch.ps1" %*
exit /b %errorlevel%
