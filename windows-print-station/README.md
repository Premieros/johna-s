# Premier Print Station for Windows

V1 is a standalone Windows printing system for `Premieros/johna-s`. It consumes the existing hardened Supabase cloud print queue and does **not** require a database migration.

## Components

- `PremierPrintStation.Service` — Windows Service, starts automatically and continuously claims/prints/acknowledges jobs.
- `PremierPrintStation` — WPF desktop monitor/configuration application.
- Local SQLite queue under `%ProgramData%\Premier\PrintStation\queue.db`.
- Machine-encrypted Supabase refresh token under `%ProgramData%\Premier\PrintStation\auth.bin` using Windows DPAPI LocalMachine scope.

## Reliability rules

1. Cloud jobs are persisted locally before printing.
2. One printer is serialized with a local semaphore; different printers may print concurrently.
3. The job is marked `printing` **before** entering the Windows spooler boundary.
4. After Windows accepts the document, state becomes `printed_pending_ack`.
5. If cloud acknowledgement fails, only the acknowledgement is retried — the paper is not printed again.
6. Only the Windows Service performs crash recovery. Opening the desktop monitor never mutates active `printing` jobs.
7. If the service restarts while a job is `printing`, that job becomes `needs_review`; it is never auto-reprinted because the physical outcome is ambiguous.
8. Failed cloud jobs can be reclaimed after backoff; a fresh cloud claim resets only safe local failed/received states and never resets `printed_pending_ack`, `printing`, `completed`, or `needs_review`.
9. Manual Retry does not print immediately. It marks the local job as approved for retry and waits for a fresh cloud claim before printing.
10. Station routing supports the common `kitchen`, `bar`, `cashier`, and `receipt` routes plus arbitrary exact station codes through custom `station_code=Windows Printer Name` mappings.

## Installation

1. Extract the `premier-print-station-windows-x64` artifact to a local folder.
2. Right-click PowerShell → **Run as Administrator**.
3. From the extracted folder run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\install.ps1
   ```
4. Open the `Premier Print Station` desktop shortcut.
5. Settings:
   - Supabase URL (defaults to the approved project `azzdesuowpdcoflmyezn`).
   - Public anon key used by the existing web application.
   - Branch UUID.
   - Map the common station codes (`kitchen`, `bar`, `cashier`, `receipt`) to installed Windows printers.
   - Add any branch-specific station codes (including Arabic/custom codes) in the custom mapping box using `station_code=Windows Printer Name`.
6. Sign in once using an authorized application user. The password is not stored; only the refresh token is persisted encrypted with Windows DPAPI.
7. Use **Test Print** and verify the dashboard heartbeat.

## Current V1 scope

- Existing `claim_cloud_print_jobs`, `start_cloud_print_job`, and `complete_cloud_print_job` RPCs are reused as-is.
- No production migration.
- No RLS weakening.
- No change to POS inventory logic.
- No change to `send_to_kitchen`.
- No change to Premier Print Agent Lite; Lite remains available as a fallback while this station is piloted.

## Data locations

`%ProgramData%\Premier\PrintStation`

- `config.json`
- `auth.bin`
- `queue.db`
- `heartbeat.json`

Uninstall intentionally preserves this directory to avoid losing queue/audit evidence.
