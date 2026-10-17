# Operational UI clarity — 2026-10-17

Scope: Premieros/johna-s only; production DB azzdesuowpdcoflmyezn, read-only diagnosis.

## Findings
Cleopatra has completed financial orders with unfinished kitchen states (76 sent, one cooking, one ready at inspection). KDS intentionally retains paid orders until served. These records must not be automatically hidden, marked served, or deleted based on age/payment.
The POS operational ready stage means all lines were sent, not that food is prepared.

## Changes and impact
- Clarify the existing POS stage label without changing stage calculation or payment eligibility.
- Explain overdue KDS cards without changing queue filters, RPCs, timers, permissions, status writes, or routing.
- Show literal zero in the operational stock quantity cell; shared formatting, valuation and reports remain intact.
- Reduce dashboard KPI spacing; metrics and queries unchanged.

No migrations, production writes, print-agent changes, print payload changes, queue changes, or send-to-kitchen changes.
No historical state repair authorized or performed. Reports/navigation restructuring is deferred to a separate reviewed scope.

## Verification and release
Run database identity guard, typecheck, lint, unit/component tests, build. UI preview and integration checks remain required before merge. Revert this single UI commit for rollback; no database rollback needed. No merge/deployment in this change.
