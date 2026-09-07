@echo off
call "%~dp0Bridge.cmd" run "%~1"
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
