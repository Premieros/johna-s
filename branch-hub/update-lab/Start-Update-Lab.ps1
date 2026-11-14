$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $PSScriptRoot 'server.mjs'))) { throw 'Extract the entire ZIP first.' }
$kind = & docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $kind -ne 'linux') { throw 'Start Docker Desktop with Linux containers first.' }
$data = Join-Path $PSScriptRoot '.update-lab-state'
New-Item -ItemType Directory -Force -Path $data | Out-Null
Write-Host 'Open http://127.0.0.1:58110 in your browser. Keep this window open.'
Write-Host 'LAB ONLY: no production, no real payments, no printing. Ctrl+C stops.'
& docker run --rm --init --read-only --cap-drop ALL --security-opt no-new-privileges `
  --memory 512m --cpus 1 --pids-limit 64 --tmpfs /tmp:rw,noexec,nosuid,size=32m `
  -p 127.0.0.1:58110:58110 `
  --mount "type=bind,source=$PSScriptRoot,target=/lab,readonly" `
  --mount "type=bind,source=$data,target=/lab-state" `
  -e JOHNAS_UPDATE_LAB_CONTAINER=1 -e JOHNAS_UPDATE_LAB_DATA=/lab-state `
  node:22-bookworm-slim node /lab/server.mjs
if ($LASTEXITCODE -ne 0) { throw 'Update lab stopped with an error. Existing services were not changed.' }
