# Hardware is mocked: this verifies the report shape, not a branch readiness result.
$ErrorActionPreference = 'Stop'
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  switch ($ClassName) {
    'Win32_OperatingSystem' { [pscustomobject]@{ Caption='Fixture Windows'; BuildNumber='fixture'; OSArchitecture='64-bit'; FreePhysicalMemory=4GB/1KB } }
    'Win32_ComputerSystem' { [pscustomobject]@{ TotalPhysicalMemory=12GB } }
    'Win32_Processor' { [pscustomobject]@{ NumberOfLogicalProcessors=4; VirtualizationFirmwareEnabled=$true } }
    'Win32_LogicalDisk' { [pscustomobject]@{ DeviceID='E:'; Size=80GB; FreeSpace=50GB } }
    default { throw 'UNEXPECTED_HARDWARE_QUERY' }
  }
}
$fixturePath = Join-Path ([System.IO.Path]::GetTempPath()) ('johnas-device-fixture-' + [guid]::NewGuid().ToString() + '.json')
try {
  & (Join-Path $PSScriptRoot '../tools/Check-BranchDevice.ps1') -OutputPath $fixturePath
  $report = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json
  if ($report.RAMGB -ne 12 -or $report.FreeRAMGB -ne 4 -or $report.LogicalProcessors -ne 4) { throw 'HARDWARE_REPORT_MISMATCH' }
  if ($report.ProductionContacted -ne $false -or $report.SoftwareInstalled -ne $false) { throw 'DIAGNOSTIC_SIDE_EFFECT_CLAIM' }
  if (@($report.Disks).Count -ne 1 -or $report.Disks[0].FreeGB -ne 50) { throw 'DISK_REPORT_MISMATCH' }
  if ($report.ReadinessDecision -notlike 'Not assessed:*') { throw 'FALSE_READINESS_CLAIM' }
  $expected = @('ReportVersion','Windows','Build','Architecture','RAMGB','FreeRAMGB','LogicalProcessors','VirtualizationFirmwareEnabled','Disks','DockerCommandAvailable','WSLCommandAvailable','ProductionContacted','SoftwareInstalled','ReadinessDecision')
  if (Compare-Object ($report.PSObject.Properties.Name | Sort-Object) ($expected | Sort-Object)) { throw 'UNEXPECTED_REPORT_FIELDS' }
  Write-Host 'PASS: mocked hardware report, exact field allowlist, no readiness/install/production claim.'
} finally {
  if (Test-Path -LiteralPath $fixturePath) { Remove-Item -LiteralPath $fixturePath }
}
