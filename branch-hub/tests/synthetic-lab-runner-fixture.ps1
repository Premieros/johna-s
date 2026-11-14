$ErrorActionPreference = 'Stop'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('johnas-lab-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path (Join-Path $temp 'branch-hub\lab'),(Join-Path $temp 'branch-hub\experiments'),(Join-Path $temp 'supabase\ci') | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\lab\Run-Synthetic-Lab.ps1') (Join-Path $temp 'branch-hub\lab')
Set-Content (Join-Path $temp 'supabase\ci\stub_auth.sql') '-- mocked source marker only'
Set-Content (Join-Path $temp 'branch-hub\experiments\package.json') '{}'
Set-Content (Join-Path $temp 'branch-hub\experiments\package-lock.json') '{}'
$global:johnasFixtureCalls = @()
$global:johnasFixtureFailRuntime = $false
function docker {
  $global:johnasFixtureCalls += ,@($args)
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'info') { return 'linux' }
  if ($args -contains '--network') {
    if ($global:johnasFixtureFailRuntime) { $global:LASTEXITCODE = 23; return '{"schemaReplayComplete":false}' }
    return '{"schemaReplayComplete":true,"financialBoundary":{"checks":[1,2,3,4,5,6,7]}}'
  }
}
try {
  & (Join-Path $temp 'branch-hub\lab\Run-Synthetic-Lab.ps1')
  if ($global:johnasFixtureCalls.Count -ne 3) { throw 'Unexpected Docker command count' }
  $runtime = $global:johnasFixtureCalls[2]
  if ($runtime[0] -ne 'run' -or $runtime -notcontains 'none' -or $runtime -notcontains '--read-only') { throw 'Isolation flags missing' }
  if (($runtime -join ' ') -match 'docker.sock|--publish|--env|--privileged|compose|exec ') { throw 'Unsafe runtime argument' }
  if ((($runtime | Where-Object { $_ -like 'type=bind,*readonly' }).Count) -ne 2) { throw 'Source and dependencies must be read-only mounts' }
  $global:johnasFixtureFailRuntime = $true
  $caught = $false
  try { & (Join-Path $temp 'branch-hub\lab\Run-Synthetic-Lab.ps1') } catch { $caught = $true }
  if (-not $caught) { throw 'Failed runtime was treated as success' }
  Write-Host 'PASS: mocked Windows runner enforces isolated execution and propagates failure.'
} finally {
  Remove-Variable johnasFixtureCalls,johnasFixtureFailRuntime -Scope Global -ErrorAction SilentlyContinue
  Remove-Item function:docker -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -Force -Recurse
}
