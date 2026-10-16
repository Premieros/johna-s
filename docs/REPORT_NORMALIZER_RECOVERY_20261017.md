# Report normalizer production dependency recovery

## Work status
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/report-normalizer-production-dependency-20261017`
Last updated: 2026-10-17 Africa/Cairo
State: **BLOCKED** — corrective exact-head CI pending

## Incident and recovery
Owner screenshot reports function public._normalize_thermal_print_payload(jsonb) does not exist on Z enqueue. Catalog confirmed missing helper, new enqueue hash e62e278ce3697ba9f848146196132754. The canonical September migration creates the helper in CI, but production lacks it. Previous frontend-only parity did not check nested PL/pgSQL calls. #520 full CI did pass but did not reproduce production missing dependency; its release safety statement is superseded by this incident.
Emergency rollback authorized by prior owner instruction to roll back immediately on proven regression: applied20261016223813_emergency_restore_report_enqueue_missing_helper. Restored original enqueue body hash582879ace6fa6ef502d695edce4a2dab; only future report enqueue. Latest-price RPCs remain. No installed Windows changes, queue replay/delete, receipt/kitchen/bar/claim/start/complete or accounting/stock writes.

## Correction
Install the exact canonical pure SECURITY INVOKER normalizer and its restrictive grants, then restore the exact tested bounded report enqueue. Do not run the old migration's trigger/backfill sections. Deployment catalog parity now requires both runtime helper signatures whenever report enqueue is in the frontend contract, without operational calls. DB regression drops the helper in a localhost savepoint, detects absence through metadata, proves the actual enqueue error, reapplies corrective SQL and requires successful bounded enqueue, then rolls back the fixture.

## Verification and gate
Targeted unit/typecheck/lint and exact-head Full Verify required before corrective SQL apply. Guard original enqueue hash and migration history before apply. Verify real runtime inside an uncommitted transaction rolled back (no printer-visible jobs), helper catalog/ACL and frozen hashes, actual migration version reconciliation, then fresh exact-head CI before merge. Production rollback already applied; existing tall-report behavior temporarily restored. No claim of paper acceptance.

## Next action
Finish tests, publish recovery PR, run exact-head CI, apply tested dependency correction and verify without committed print jobs.
