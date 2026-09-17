param(
  [string]$InstallDir = "$env:ProgramFiles\Premier Print Station"
)

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Run install.ps1 as Administrator.'
}

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceName = 'PremierPrintStation'
$serviceExe = Join-Path $InstallDir 'service\PremierPrintStation.Service.exe'
$desktopExe = Join-Path $InstallDir 'desktop\PremierPrintStation.exe'

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 1
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item (Join-Path $source 'service') $InstallDir -Recurse -Force
Copy-Item (Join-Path $source 'desktop') $InstallDir -Recurse -Force
Copy-Item (Join-Path $source 'uninstall.ps1') $InstallDir -Force

sc.exe create $serviceName binPath= "`"$serviceExe`"" start= auto DisplayName= "Premier Print Station" | Out-Null
sc.exe description $serviceName "Durable Premier POS print queue and Windows spooler bridge" | Out-Null
sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/30000 | Out-Null
Start-Service -Name $serviceName

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Premier Print Station.lnk'
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $desktopExe
$shortcut.WorkingDirectory = Split-Path $desktopExe
$shortcut.Save()

Write-Host "Installed Premier Print Station to: $InstallDir" -ForegroundColor Green
Write-Host 'Open the desktop shortcut, configure Supabase/Branch/Printers, then sign in once.' -ForegroundColor Cyan
