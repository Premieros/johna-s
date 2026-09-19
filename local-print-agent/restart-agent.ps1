param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$port = 17654
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$agent = Join-Path $root 'agent.cjs'

$node = (Get-Command node.exe -ErrorAction Stop).Source

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $commandLine = [string]$process.CommandLine
  $isJohnsAgent = $process -and
    $process.Name -ieq 'node.exe' -and
    $commandLine -match 'agent\.cjs'

  if (-not $isJohnsAgent) {
    throw "PORT_17654_IN_USE_BY_OTHER_PROCESS:$($listener.OwningProcess)"
  }

  Stop-Process -Id $listener.OwningProcess -Force
  Start-Sleep -Milliseconds 500
}

Start-Process -FilePath $node -ArgumentList ('"' + $agent + '"') -WorkingDirectory $root -WindowStyle Hidden

$health = $null
for ($attempt = 1; $attempt -le 10; $attempt++) {
  Start-Sleep -Milliseconds 350
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Method Get -TimeoutSec 2
    if ($health) { break }
  } catch {}
}

if (-not $health) {
  throw 'PRINT_AGENT_HEALTHCHECK_FAILED'
}

if ([int]$health.version -ne 4) {
  throw "WRONG_PRINT_AGENT_VERSION:$($health.version)"
}

if ([string]$health.transport -ne 'escpos-raw-raster') {
  throw "WRONG_PRINT_TRANSPORT:$($health.transport)"
}

Write-Output "JOHNS_PRINT_AGENT_OK version=$($health.version) transport=$($health.transport)"

if (-not $NoBrowser) {
  Start-Process "http://127.0.0.1:$port/"
}
