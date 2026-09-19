param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$PrinterName,
  [Parameter(Mandatory = $true, Position = 1)]
  [string]$FilePath
)

$ErrorActionPreference = 'Stop'

if (!(Test-Path -LiteralPath $FilePath)) {
  throw 'DRAWER_FILE_NOT_FOUND'
}

Get-Content -LiteralPath $FilePath -Encoding Byte -Raw | Out-Printer -Name $PrinterName
Write-Output 'DRAWER_KICK_SUBMITTED'
