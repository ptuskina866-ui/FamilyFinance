@echo off
cd /d "%~dp0"
node tools\prior-local\server.ts
if errorlevel 1 pause
