@echo off
call "%~dp0Bridge.cmd" run "%~1"
if errorlevel 1 pause
