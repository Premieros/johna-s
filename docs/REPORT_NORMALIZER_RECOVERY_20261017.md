# Report normalizer production dependency recovery

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-normalizer-production-dependency-20261017`
Current PR: #521
Last updated: 2026-10-17 Africa/Cairo
State: **BLOCKED** — SQL repaired; source reconciliation CI pending

## Guardrails
No Windows install/stop, physical jobs, old report replay, kitchen/bar/receipt or stock/accounting writer changes. One writer and exact-head gates.

## Baseline
Main baea7c9b. Latest-price read changes retained; emergency report rollback applied.

## Root-cause ledger
Owner screenshot reports function public._normalize_thermal_print_payload(jsonb) does not exist on Z enqueue. Catalog confirmed missing helper, new enqueue hash e62e278ce3697ba9f848146196132754. The canonical September migration creates the helper in CI, but production lacks it. Previous frontend-only parity did not check nested PL/pgSQL calls. #520 full CI did pass but did not reproduce production missing dependency; its release safety statement is superseded by this incident.
Emergency rollback authorized by prior owner instruction to roll back immediately on proven regression: applied20261016223813_emergency_restore_report_enqueue_missing_helper. Restored original enqueue body hash582879ace6fa6ef502d695edce4a2dab; only future report enqueue. Latest-price RPCs remain. No installed Windows changes, queue replay/delete, receipt/kitchen/bar/claim/start/complete or accounting/stock writes.

## Change ledger
Install the exact canonical pure SECURITY INVOKER normalizer and its restrictive grants, then restore the exact tested bounded report enqueue. Do not run the old migration's trigger/backfill sections. Deployment catalog parity now requires both runtime helper signatures whenever report enqueue is in the frontend contract, without operational calls. DB regression drops the helper in a localhost savepoint, detects absence through metadata, proves the actual enqueue error, reapplies corrective SQL and requires successful bounded enqueue, then rolls back the fixture.

## Verification ledger
26 targeted parity/drift tests and test typecheck passed; lint clean. Original report runtime succeeded inside an uncommitted transaction, then rolled back; independent follow-up found zero persisted diagnostic jobs. Initial CI stopped on missing worklog headings; completed required structure. Corrected exact head93336af: Full Verify38977265442 and Fast38977260522 GREEN,1097 DB/RLS including missing-helper reproduction/repair. Applied tested correction as20261016224825; same SQL renamed to actual version. Helper bodyde7e62b987ff0244ac08a605551fa49d, enqueue bodye62e278ce3697ba9f848146196132754. Authenticated rollback-only enqueue created6 transient pages and same-key retry deduplicated, all rolled back, independent query confirms no diagnostic jobs. Runtime-helper catalog contract now all present. Stock/sale/claim/start/complete/can-execute hashes unchanged. An initial diagnostic combined enqueue with a broad RLS job-table read and hit5s timeout in user_may_access_branch; replaced that diagnostic with only exact enqueue/root-key calls, which succeeded. No benchmark retry or timeout limit increase. Fresh source-reconciled CI required before merge.

## Production gate
Targeted unit/typecheck/lint and exact-head Full Verify required before corrective SQL apply. Guard original enqueue hash and migration history before apply. Verify real runtime inside an uncommitted transaction rolled back (no printer-visible jobs), helper catalog/ACL and frozen hashes, actual migration version reconciliation, then fresh exact-head CI before merge. Production rollback already applied; existing tall-report behavior temporarily restored. No claim of paper acceptance.

## Next action
Finish source-reconciled exact-head CI, merge, verify deployment parity includes both runtime helpers and postmerge checks. Production runtime already repaired; no Windows update.

## Mandatory update protocol
Single writer; unexpected remote HEAD STOP_AND_RECONCILE. Record exact head, CI result, SQL version and actual runtime verification. No repeated benchmark retries or inferred physical success.
