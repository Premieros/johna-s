$ErrorActionPreference = 'Stop'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('johnas-update-launcher-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $temp | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\update-lab\Start-Update-Lab.ps1') $temp
Set-Content (Join-Path $temp 'server.mjs') '// fixture only'
$global:johnasUpdateCalls = @()
function docker {
  $global:johnasUpdateCalls += ,@($args)
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'info') { return 'linux' }
}
try {
  & (Join-Path $temp 'Start-Update-Lab.ps1')
  if ($global:johnasUpdateCalls.Count -ne 2) { throw 'Unexpected Docker commands' }
  $runtime = $global:johnasUpdateCalls[1]
  if ($runtime[0] -ne 'run' -or $runtime -notcontains '--read-only' -or $runtime -notcontains '127.0.0.1:58110:58110') { throw 'Loopback/read-only runtime flags missing' }
  if (($runtime | Where-Object { $_ -eq '-p' }).Count -ne 1) { throw 'Only UI port may be published' }
  if (($runtime -join ' ') -match 'docker.sock|--privileged|compose|exec ') { throw 'Unexpected access to existing services' }
  if (($runtime | Where-Object { $_ -like 'type=bind,*readonly' }).Count -ne 1) { throw 'Lab source must be read-only' }
  Write-Host 'PASS: update lab launcher publishes UI on loopback only and leaves existing services untouched.'
} finally {
  Remove-Item function:docker -ErrorAction SilentlyContinue
  Remove-Variable johnasUpdateCalls -Scope Global -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -Force -Recurse
}
$global:LASTEXITCODE = 0
