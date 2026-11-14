@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Synthetic-Lab.ps1"
if errorlevel 1 echo Synthetic test did not complete successfully.
pause
