# Smouha Z report and cashier areas

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/smouha-zreport-cashier-areas-20261016`
Current PR: #0 (preparing)
Last updated: 2026-10-16
State: **BLOCKED**

## Guardrails
One Windows computer / two cashier printers, confirmed by owner. No kitchen/bar routing changes. No production migration, merge, physical print, queue replay or enabling #507. Preserve frozen V7 claim/start/complete functions and all accounting/inventory/sale writers. New agent must replace, never compete with, existing consumer at cutover.

## Baseline
Main c21c7b772789e46f0e8d62711902d1a6c43e4e50, #517/#518 fully verified/deployed. V8.1 source; installed executable version and printer model not yet proven.

## Root-cause ledger
Read-only production sample: latest report has 387 text lines; two previous reports 527. All submitted once, not physical confirmation. Current text renderer uses 39 dots/line at 203dpi, wraps and emits entire bitmap in one GS v 0 command. 527 lines already imply ~2.58m before wrapping. Firmware/driver interpretation causing gibberish is not proven. Do not claim hardware fix without paper acceptance. Cashier routes currently hardcoded at enqueue; agent supports arbitrary dictionary routes but setup exposes only one cashier.

## Change ledger
V8.2 report-only Windows GDI image path, <=150mm pages, compact text; unknown spool outcome is terminal with no automatic transport fallback. Kitchen/bar/receipt raster path defaults unchanged. Setup exposes optional cashier_2 on same Windows. Thermal materials use two source lines instead of four with identical quantities and actual/estimated costs.
New opt-in station/area settings tables and invoker RPCs with branch/permission/RLS checks. Receipt enqueues resolve only authoritative sale/order table and area; unchanged pending jobs/idempotency, no history writes. Primary remains fallback/no-table/Z/drawer. UI requires device readiness before activation. Frozen claim/start/complete functions untouched.
Rollback source definitions saved in scripts/rollback/cashier_area_routing_restore_20261016.sql; disable routing and drain queued second-station jobs with compatible agent before agent rollback.

## Verification ledger
Focused UI/material/agent/worklog tests: 26 passed. Full app + test typechecks pass; initial PromiseLike catch and integration result typing errors corrected. Targeted ESLint passes. Windows offline render/pagination tests added (527 Arabic lines, 58/80mm, final-line ink and exact source coverage); Windows build pending. New localhost-only DB tests cover fallback, branch/permission failures, forged routing payload, actual open/sale enqueue, pending-job reuse, primary Z. No operational writes or physical tests.

## Production gate
BLOCKED pending exact-head app/DB/browser/Windows build checks, review of report transport and two-printer routing, executable SHA256 and owner rollout approval. DB station configuration stays inactive by default. No historical jobs modified.

## Next action
Fix report transport/length with offline tests, then server-authoritative receipt routing and two-printer setup. Keep Z/default drawer at primary cashier.

## Mandatory update protocol
Update this log on scope, root cause, verification or gate changes. Single writer. Unexpected remote HEAD: STOP_AND_RECONCILE. Exact frozen-head CI required before merge.
