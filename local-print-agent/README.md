# Johns Local Print Service (Windows)

This service lets the browser POS route kitchen tickets to different Windows printers without showing the browser print dialog.

## What it does

- Runs only on `127.0.0.1:17654`.
- Reads printers installed in Windows.
- Stores printer names locally in `printer-config.json` on this terminal only.
- Routes each KDS station code to a Windows printer.
- The POS keeps the normal browser print as a fallback if the local service is unavailable or a station is not configured.

## Stability v2

The v2 agent keeps the existing HTTP contract but hardens delivery on busy terminals:

- Serializes work per physical printer so two tickets cannot be sent to the same Windows printer at the same time.
- Retries transient Windows/PowerShell/spooler failures up to 3 attempts by default.
- Adds a PowerShell timeout so a stuck print command cannot block the queue forever.
- Caches the installed-printer list briefly instead of launching `Get-Printer` for every request.
- Accepts optional `jobId` or `job_id` on `/print`. Repeated or concurrent requests with the same ID are printed once and reported as `deduplicated: true`.
- Keeps backward compatibility: callers that do not send a job ID still print normally.
- Serializes cash-drawer commands through the same printer queue.
- `/health` now reports agent version and active queue/in-flight counters.

Optional environment variables:

- `JOHNS_PRINT_PS_TIMEOUT_MS` — PowerShell command timeout (default `15000`).
- `JOHNS_PRINT_PRINTER_CACHE_TTL_MS` — installed-printer cache duration (default `5000`).
- `JOHNS_PRINT_RETRY_ATTEMPTS` — print/drawer attempts (default `3`).
- `JOHNS_PRINT_RETRY_DELAY_MS` — retry base delay in milliseconds (default `350`).
- `JOHNS_PRINT_DEDUPE_TTL_MS` — completed job ID retention (default `600000`, minimum 60000).

## Branch setup

1. Install both thermal printers in Windows and confirm a Windows test page prints from each one.
2. Install Node.js LTS on the cashier PC if it is not already installed.
3. Run `start.cmd` from this folder.
4. The configuration page opens at `http://127.0.0.1:17654/`.
5. Map stations for the current Johns production data:
   - `drinks` -> the barista/drinks printer.
   - `main` -> the kitchen/food printer.
6. Use **Test Print** on both mappings before the first real order.
7. In Johns, drink categories must be assigned to the `drinks` kitchen station; food categories stay on `main`. The server, not the browser, decides each item's station.

## Important

Do not store physical Windows printer names in Supabase. They belong to this PC and can differ between terminals.

The print agent must be running while the browser POS is open. If it is not running, Johns falls back to the existing browser kitchen print flow rather than silently dropping the ticket.
