@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "NODE_OPTIONS="
set "NODE_PATH="
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0_launcher\Update.ps1" -Action recover-lock
set "result=%errorlevel%"
if "%result%"=="0" echo Recovery complete. Open M365Relay.cmd to start.
pause
exit /b %result%
