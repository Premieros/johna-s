# Z-Report / Current Shift Workday Fix — 2026-09-18

Branch: `development/zreport-text-current-shift-day-20260918`
Base: `42ea77aaa555cccbd803ec3300acc2ad425e941f`

## Scope

1. Thermal Z-Report sent to the cashier cloud-print station uses plain text payload (`payload.text`) instead of sending HTML/CSS as printable text.
2. The live current-workday report starts at the currently open shift in both `fixed_time` and `shift_span` modes.
3. Previous shifts, purchases and expenses are excluded from the live current-workday window.
4. Once no shift is open, historical/final day reporting returns to the configured canonical window, preserving final day-close history.
5. The canonical `_resolve_business_day_window()` is unchanged, so fixed-time day-end/auto-close semantics are not altered.

## Safety

- No changes to the Windows/Electron Print Agent.
- No printer routing/station changes; Z-Report still targets cashier.
- No RLS weakening.
- No role-name authorization.
- Database change is one replacement of the existing internal `_build_day_closing_report(uuid,date)` function; `_resolve_business_day_window(uuid,date)` is not changed.
- Production migration must wait for Full Verify Green and explicit approval.
