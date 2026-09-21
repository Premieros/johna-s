@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$dir=[IO.Path]::GetFullPath('%SCRIPT_DIR%');" ^
  "$target=Join-Path $dir 'template-print.ps1';" ^
  "$tmp=Join-Path $env:TEMP ('johns-template-print-' + [Guid]::NewGuid().ToString('N') + '.ps1');" ^
  "$url='https://raw.githubusercontent.com/Premieros/johna-s/main/local-print-agent/template-print.ps1';" ^
  "try {" ^
  "  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp;" ^
  "  $body=Get-Content -LiteralPath $tmp -Raw -Encoding UTF8;" ^
  "  if ($body -notmatch 'FIXED_TEMPLATE_VERSION_UNSUPPORTED' -or $body -notmatch '\$doc\.Print\(\)') { throw 'RENDERER_VALIDATION_FAILED' };" ^
  "  if (Test-Path -LiteralPath $target) {" ^
  "    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss';" ^
  "    Copy-Item -LiteralPath $target -Destination ($target + '.bak-' + $stamp) -Force;" ^
  "  }" ^
  "  Move-Item -LiteralPath $tmp -Destination $target -Force;" ^
  "  Write-Host 'Johns renderer updated successfully. No reinstall or printer remapping is required.';" ^
  "} finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } }"
if errorlevel 1 (
  echo Renderer update failed. Existing print service and printer mappings were left unchanged.
  exit /b 1
)
echo Renderer update completed. The print service does not need reinstalling.
exit /b 0
