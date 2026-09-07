@echo off
call "%~dp0Bridge.cmd" init
set "result=%errorlevel%"
pause
exit /b %result%
