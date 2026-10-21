@echo off
cd /d "%~dp0"
node src\launch.cjs
if errorlevel 1 pause
