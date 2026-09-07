@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
rem Use Windows PowerShell's own modules even when launched from PowerShell 7.
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Launch.ps1" %*
exit /b %errorlevel%
