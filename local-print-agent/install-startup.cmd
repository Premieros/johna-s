@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS first.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($w.SpecialFolders('Startup')+'\Johns Print Service.lnk'); $s.TargetPath=(Get-Command powershell.exe).Source; $s.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%~dp0restart-agent.ps1"" -NoBrowser'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Johns local printer routing service'; $s.Save()"
if errorlevel 1 (
  echo Failed to create startup shortcut.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-agent.ps1"
if errorlevel 1 (
  echo Failed to start the ESC/POS raster print agent.
  pause
  exit /b 1
)

echo Johns Print Service v5 is installed and verified.
pause
