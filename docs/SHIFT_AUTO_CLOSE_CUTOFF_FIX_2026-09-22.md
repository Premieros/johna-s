# Shift Auto-Close Cutoff Repair — 2026-09-22

## Scope
- Repository: `Premieros/johna-s`
- Branch: `development/business-day-auto-close-cutoff-fix-20260922`
- Production database is not changed by this branch commit.
- Printing, POS routing, stock, and payment logic are untouched.

## Incident
Smouha branch was configured with:
- business day start: 08:00
- business day end: 03:00
- auto-close: enabled

Newly opened shifts were closed within seconds with `AUTO_CLOSED_AT_BUSINESS_DAY_END`.

## Root cause
The 2026-09-21 business-day rollover work made the live report window intentionally expose `end_at=now()` while a shift is open. The older auto-close RPC reused that report window and therefore treated the current instant as the configured business-day end.

## Repair
`try_auto_close_branch_shift(uuid)` now:
1. Reads the persisted current business date.
2. Computes the configured cutoff directly from `business_day_start` / `business_day_end` in `Africa/Cairo`.
3. Correctly handles overnight windows such as 08:00 -> 03:00.
4. Ensures the computed cutoff is strictly after the shift opening instant.
5. Preserves the existing open-order safety block and cash-count behavior.
6. Does not change report-window semantics.

## Temporary production safeguard
Auto-close was disabled for Smouha only before this code repair so operations could continue. It must only be re-enabled after verification of this permanent fix.
