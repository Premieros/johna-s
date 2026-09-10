# Windows Print Fix

## Scope

This change fixes Electron Desktop silent-print execution only.

- Printer discovery remains unchanged.
- Device-local cashier/main/drinks routes remain unchanged.
- POS, KDS, inventory, approvals, permissions and Supabase are not modified.
- Receipt/kitchen text no longer uses PowerShell `Out-Printer`.
- Text is escaped, wrapped in a printable UTF-8 HTML document and sent through Electron/Chromium `webContents.print` with the exact detected `deviceName`.
- Print Truth remains fail-closed: the bridge returns success only when Electron's print callback reports success.
- Cash-drawer handling remains a separate path.

## Reported regression

Electron Desktop was connected and Windows printers were detected successfully, routes were saved successfully, but the per-printer test returned a print failure. The previous text path used PowerShell `Out-Printer`, which is separate from Electron's detected printer pipeline and can fail even when `getPrintersAsync()` reports the printer correctly.
