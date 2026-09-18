# Z-Report / Current Shift Workday Fix — 2026-09-18

Branch: `development/zreport-text-current-shift-day-20260918`
Base: `42ea77aaa555cccbd803ec3300acc2ad425e941f`

## Scope

1. Thermal Z-Report sent to the cashier cloud-print station uses plain text payload (`payload.text`) instead of sending HTML/CSS as printable text.
2. A live `shift_span` business-day report starts at the currently open shift.
3. Previous shifts, purchases and expenses are excluded from the live current-workday window.
4. Once no shift is open, historical/final day resolution returns to the existing first-shift-through-last-shift window, preserving final day-close history.
5. `fixed_time` mode is unchanged so configured day-end/auto-close semantics are not altered.

## Safety

- No changes to the Windows/Electron Print Agent.
- No printer routing/station changes; Z-Report still targets cashier.
- No RLS weakening.
- No role-name authorization.
- Database change is one replacement of the existing internal `_resolve_business_day_window(uuid,date)` function.
- Production migration must wait for Full Verify Green and explicit approval.
