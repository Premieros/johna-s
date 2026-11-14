$ErrorActionPreference = 'Stop'
# Uses disposable containers only. Never calls compose/exec or existing databases.
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not (Test-Path (Join-Path $repo 'supabase\ci\stub_auth.sql'))) {
  throw 'Extract the complete repository ZIP before running this file.'
}
$experiments = Join-Path $repo 'branch-hub\experiments'
$cache = Join-Path $PSScriptRoot '.lab-deps'
$report = Join-Path $PSScriptRoot 'synthetic-lab-result.json'
$image = 'node:22-bookworm-slim'
$dockerKind = & docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $dockerKind -ne 'linux') { throw 'Start Docker Desktop with Linux containers, then retry.' }
New-Item -ItemType Directory -Force -Path $cache | Out-Null
Copy-Item (Join-Path $experiments 'package.json') $cache -Force
Copy-Item (Join-Path $experiments 'package-lock.json') $cache -Force
Write-Host 'Preparing the isolated test dependency. Internet is needed for this step.'
& docker run --rm --cap-drop ALL --security-opt no-new-privileges --memory 2g --cpus 2 `
  --mount "type=bind,source=$cache,target=/deps" -w /deps $image `
  npm ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Dependency preparation failed. Existing services were not changed.' }
Write-Host 'Running synthetic financial checks with container networking disabled.'
$result = & docker run --rm --network none --read-only --cap-drop ALL `
  --security-opt no-new-privileges --memory 2g --cpus 2 --pids-limit 128 `
  --tmpfs /tmp:rw,noexec,nosuid,size=256m `
  --mount "type=bind,source=$repo,target=/source,readonly" `
  --mount "type=bind,source=$cache,target=/deps,readonly" -w /source $image `
  node branch-hub/experiments/probe-pglite-schema.mjs /deps/node_modules/@electric-sql/pglite --financial-boundary
$code = $LASTEXITCODE
$result | Set-Content -Encoding UTF8 -Path $report
$result | Write-Host
if ($code -ne 0) { throw "Synthetic test failed. See $report. Existing databases were not changed." }
$parsed = ($result -join "`n") | ConvertFrom-Json
if (-not $parsed.schemaReplayComplete -or $parsed.financialBoundary.checks.Count -ne 7) {
  throw 'Incomplete test result. Do not treat this as a passing trial.'
}
Write-Host "PASS: synthetic checks only. Report: $report"
Write-Host 'This is not a POS screen, installer, cloud sync, or branch cutover.'
