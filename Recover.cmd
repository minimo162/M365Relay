@echo off
call "%~dp0Bridge.cmd" recover-lock
set "result=%errorlevel%"
if "%result%"=="0" echo Recovery complete. Open Run.cmd to start M365Relay.
pause
exit /b %result%
