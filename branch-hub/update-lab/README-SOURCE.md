# Browser update lab — inspectable source package

This package contains the HTML and Node source only, plus checksums. It does not
include CMD or PowerShell launch scripts. No execution-policy setting or browser
protection needs to be disabled. The browser's earlier archive warning has not
been diagnosed or declared a false positive; a source package is not a malware
scan certificate. If your browser also blocks this package, stop rather than
rename it or override the warning.

Inspect `server.mjs`, `release-contract.mjs`, `index.html` and `SHA256SUMS`. The
server makes HTTP requests only to its own loopback simulated feed. No Supabase,
GitHub, printer, customer information or production credentials are involved.
This is a synthetic presentation-update demo, not the original POS or a real
cloud/code/SQL update mechanism. Do not use real business data.

Extract all files into `E:\Johnas_Update_Lab`. Keep Docker Desktop running in
Linux container mode. Run the following directly in a normal PowerShell window:

```powershell
docker run --rm --init --name johnas-browser-update-lab --read-only --cap-drop ALL --security-opt no-new-privileges --memory 512m --cpus 1 --pids-limit 64 --tmpfs /tmp:rw,noexec,nosuid,size=32m -p 127.0.0.1:58110:58110 --mount "type=bind,source=E:\Johnas_Update_Lab,target=/lab,readonly" --mount type=volume,source=johnas-browser-update-lab-data,target=/lab-state -e JOHNAS_UPDATE_LAB_CONTAINER=1 -e JOHNAS_UPDATE_LAB_DATA=/lab-state node:22-bookworm-slim node /lab/server.mjs
```

This starts one disposable lab container, publishes only loopback port 58110,
reads only this source folder, and creates/uses the dedicated Docker volume
`johnas-browser-update-lab-data` for synthetic drafts, active presentation state
and LAB signing keys. It does not mount the Docker socket or use an existing
database volume. Node image is reused from your previous trial or downloaded
if absent. Do not reuse the generated lab signing keys for production.

Open http://127.0.0.1:58110. Write a fictional draft, publish a synthetic release,
then try disconnecting/reconnecting the simulated update source. The screen
updates automatically without a reload. The fake-payment barrier delays activation
until its three-second operation ends. A corrupt presentation is rejected.

Keep the PowerShell window open. Press Ctrl+C there to stop. If the lab remains
running after a window is closed, stop only its explicitly named container:

```powershell
docker stop johnas-browser-update-lab
```

Run the first command again for a normal restart; its dedicated data volume stays.
Do not delete Supabase volumes, reset passwords, change branch URLs, disable
Windows protection or open firewall ports to run this demonstration. LAN/phone
access is not enabled in this personal-PC trial. Full code/schema migration,
real login/authorization, live cloud feed and financial synchronization are still
future work. Normal restart was tested; sudden power-loss guarantees were not.
