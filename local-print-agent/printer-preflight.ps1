param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$PrinterName
)

$ErrorActionPreference = 'Stop'

$svc = Get-Service -Name Spooler -ErrorAction Stop
if ($svc.Status -ne 'Running') {
  throw 'PRINT_SPOOLER_NOT_RUNNING'
}

$printer = Get-Printer -Name $PrinterName -ErrorAction Stop
if ($printer.PrinterStatus -eq 'Offline') {
  throw 'PRINTER_OFFLINE'
}

Write-Output 'PRINTER_PREFLIGHT_OK'
