param(
  [string]$InstallDir = "$env:ProgramFiles\Premier Print Station"
)

$ErrorActionPreference = 'Stop'
$serviceName = 'PremierPrintStation'
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 1
}

$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Premier Print Station.lnk'
if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
Write-Host 'Premier Print Station removed. Local queue/config under ProgramData were intentionally preserved.' -ForegroundColor Green
