# Windows Thermal Print V2

## Goal

Prevent one slow or broken Windows thermal printer from blocking cashier/kitchen/barista printing in the Premier POS desktop app.

## Runtime guarantees

- Each Windows printer name has an independent serialized queue.
- Each printer has its own hidden Electron print worker.
- Different printers can spool concurrently; one printer cannot block another printer queue.
- Same-printer jobs remain ordered to avoid receipt interleaving.
- Page loading and native `webContents.print()` are bounded by timeouts.
- A timed-out native print is delivery-ambiguous and is **not retried automatically**, preventing duplicate receipts.
- Cash drawer PowerShell calls have a bounded timeout.
- The renderer can query queue diagnostics through `getPrintQueueState()`.
- `success: true` means Electron/Windows accepted the job for spooling; it does not claim physical paper output.

## Thermal support

- Silent Windows printing by exact Windows printer device name.
- 58 mm and 80 mm paper widths.
- HTML receipts and plain-text receipts.
- Multiple copies (bounded to 1..5).
- NSIS installer and x64 portable Windows build.

## Operational notes

1. Install the correct Windows driver for every thermal printer.
2. Give each printer a stable, unique Windows queue name, for example `casher`, `kit`, `bar`.
3. Configure those exact names in the POS printer mapping.
4. If Windows itself keeps a failed job in its spooler, the desktop app will time out and continue serving other printer queues instead of hanging the POS.
5. Do not automatically retry a `PRINT_TIMEOUT`; verify the physical printer/spooler first because Windows may still release the original job later.
