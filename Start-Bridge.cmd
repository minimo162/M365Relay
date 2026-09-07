@echo off
call "%~dp0Bridge.cmd" serve
if errorlevel 1 pause
