# Auto Business Day Close CI Time Boundary Fix — 2026-09-28

Repository: `Premieros/johna-s`
Branch: `development/fix-auto-business-day-close-ci-20260928`
Current PR: `#0`

## Scope
Fix only the flaky integration test for automatic fixed-time business-day close.

## Root cause
The test used Cairo `current_date - 1` as the due business date. For an overnight business window (08:00 -> 02:30), a run between 00:00 and 02:30 Cairo means that date has not reached its configured cutoff yet, so the worker correctly returns zero closes.

## Fix
Select the most recent business date whose configured cutoff is already <= now() while the following date's cutoff is still > now(). This makes the fixture time-independent without changing Production business-day logic.

## Safety
- No Production schema/function change.
- No treasury/day-journal change.
- No printing / Print Agent / routing / KDS changes.
- No sales/shifts behavior change.

## Verification
Pending exact-head Verify.
