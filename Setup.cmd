@echo off
call "%~dp0Bridge.cmd" setup
set "result=%errorlevel%"
pause
exit /b %result%
