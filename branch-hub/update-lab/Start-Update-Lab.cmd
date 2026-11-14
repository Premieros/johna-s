@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Update-Lab.ps1"
if errorlevel 1 echo Update lab did not finish normally.
pause
