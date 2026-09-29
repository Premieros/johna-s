# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Stability Closure / Architecture Containment / no feature development**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `bb4cac71c3a6f57d1d75b5b5d23f6d75c319549f`
- Active development branch: `development/stability-closure-architecture-containment-20260928`
- Mandatory active work log: `docs/STABILITY_CLOSURE_ARCHITECTURE_CONTAINMENT_2026-09-28.md`

## Emergency hotfix now reconciled from main
- PR #407 — POS duplicate persisted line identity — merged to main at `bb4cac71c3a6f57d1d75b5b5d23f6d75c319549f`.
- The hotfix preserves exact persisted `order_items.id` identity across resume/transfer/split/Void flows.
- It introduced no Production migration, inventory deduction change, printing/KDS routing change, payment change, or shift change.
- PR #402 reconciled this hotfix via merge commit `bfecf962efb8f824a30dcd245193b68cec5c75d7` without force push.
- Final verification for PR #402 must run on the post-reconciliation head before merge.

## Completed parallel work now present on main
The parallel product/costing repair is complete and is no longer an active execution track:
- Former track: **Hotfix — canonical theoretical costing source**
- Former branch: `hotfix/costing-theoretical-source-20260928`
- Historical log: `docs/COSTING_THEORETICAL_HOTFIX_2026-09-28.md`
- Main now contains the decimal input, linked component-group costing, and canonical theoretical-cost source work from that track.
- Product/costing files are no longer deferred solely because of parallel work. They may be touched by this stability track only when needed for measured containment/performance work and only after latest-main reconciliation.

## Closed predecessor
The previous track **Stability Foundation** is complete, merged, deployed, and closed for execution:
- Old branch: `development/stability-foundation-20260928`
- Merged PR: #401
- Merge commit: `69ee1d0c80d43bcdecfdb2a104455eafe7a5349b`
- Post-merge Verify main #3296: Green
- Deploy #859: Green
- Old log: `docs/STABILITY_FOUNDATION_2026-09-28.md` is historical evidence only and MUST NOT be used as the active execution plan.

## Repository branch policy
Long-lived branches intentionally preserved:
1. `main`
2. `development/cleopatra-v811-final`
3. `development/smouha-v811-realtime-final`

Current temporary active development branch:
4. `development/stability-closure-architecture-containment-20260928`

All other normal development branches are temporary and should be deleted after verified merge/closure.

## Active PR policy
The two latest Print Agent PRs remain intentionally retained outside this track:
- #365 — Cleopatra V8.1.1 final
- #357 — Smouha V8.1.1 final

The Stability Foundation PR #401 is merged/closed and is not an execution baseline.
PR #402 is the active Stability Closure PR and remains Draft until the final merge gate.

## Safety fence
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو لا يطابق المسار النشط.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- لا Merge إلى `main` إلا بعد نفس البوابة وبموافقة صريحة.
- Single writer on the active development branch.
- No direct write to `main`.
- No force push.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- No weakening Permission-First, branch isolation, RLS, tests, or Super Admin implicit-bypass rules.
- Printing / Print Agent / routing / KDS / `send_to_kitchen` behavior are frozen unless a separately proven regression requires a reviewed fix.
- No Production data rewrite/reset/reseed to make tests pass.
- Runtime changes must remain safe for currently operating Smouha and Cleopatra branches.

## Current objective
Do not add product features. Close the remaining structural and operational stability debt after Stability Foundation:
1. source-of-truth and branch hygiene;
2. formal latency/call budgets for critical paths;
3. measured repair of remaining performance hotspots;
4. containment of oversized/heavy pages behind domain/feature services;
5. monotonic reduction of the legacy direct-Supabase page allowlist;
6. centralized runtime state and System Health severity semantics;
7. minimal device/workstation operational identity foundation;
8. restore/recovery and rollback readiness.

Detailed phase gates, findings, budgets, and change ledger are maintained only in:
`docs/STABILITY_CLOSURE_ARCHITECTURE_CONTAINMENT_2026-09-28.md`

## Definition of done
This track is complete only when:
- exact-head Fast Verify and Full Verify are Green;
- Production API parity is Green;
- critical page/RPC latency and call budgets are documented and verified;
- priority heavy pages have bounded data orchestration behind service/domain boundaries;
- the legacy direct-Supabase page allowlist is materially reduced and cannot grow;
- runtime state is centralized/testable and System Health has explicit severity thresholds;
- restore/recovery has been rehearsed on non-Production;
- latest `main` has been reconciled into this branch;
- no stale active work references remain;
- Smouha and Cleopatra remain operational;
- no unexpected printing/KDS/agent behavior changed.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
