param([string]$OutputPath = '')
# Read-only hardware inventory. No installer, service/registry writes or network calls.
# No accounts, IP/MAC addresses, printer names or credentials are collected.
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'branch-device-report.json' }
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$processors = @(Get-CimInstance Win32_Processor)
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [ordered]@{ Drive = $_.DeviceID; SizeGB = [math]::Round($_.Size / 1GB, 1); FreeGB = [math]::Round($_.FreeSpace / 1GB, 1) }
})
$report = [ordered]@{
  ReportVersion = 1
  Windows = $os.Caption
  Build = $os.BuildNumber
  Architecture = $os.OSArchitecture
  RAMGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
  FreeRAMGB = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 1)
  LogicalProcessors = ($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
  VirtualizationFirmwareEnabled = @($processors | Where-Object { $_.VirtualizationFirmwareEnabled -eq $true }).Count -gt 0
  Disks = $disks
  DockerCommandAvailable = [bool](Get-Command docker.exe -ErrorAction SilentlyContinue)
  WSLCommandAvailable = [bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)
  ProductionContacted = $false
  SoftwareInstalled = $false
  ReadinessDecision = 'Not assessed: sizing and engine benchmarks are still required.'
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$report | Format-List
Write-Host "Hardware report saved to $OutputPath"
