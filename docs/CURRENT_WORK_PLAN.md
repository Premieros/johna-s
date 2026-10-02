# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Web Cloud Print realtime wake hardening**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `84f4a1d78dcbe9f637f1e19d26b33de24592da73`
- Active development branch: `hotfix/web-cloud-print-realtime-wake-20261002`
- Mandatory active work log: `docs/WEB_CLOUD_PRINT_REALTIME_WAKE_2026-10-02.md`

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
4. `hotfix/web-cloud-print-realtime-wake-20261002`

All other normal development branches are temporary and should be deleted after verified merge/closure.

## Active PR policy
The two latest Print Agent PRs remain intentionally retained outside this track:
- #365 — Cleopatra V8.1.1 final
- #357 — Smouha V8.1.1 final

The Stability Foundation PR #401 is merged/closed and is not an execution baseline.
PR #423 (month-opening raw-material stock-count Excel workflow) is merged on main at `1cfaec2d22ce55cfec2ce58cca1222eca564d828` and is historical for this emergency track.
The active emergency PR is the latest-main-synced stale-client duplicate sent-line containment branch above.

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
Reduce historical browser Cloud Print polling/log load without touching installed restaurant Print Agent programs:
1. replace the browser 700ms durable-queue polling loop with existing branch-filtered `cloud_print_wake_state` Realtime wake;
2. retain immediate initial drain of already-pending jobs;
3. reconcile every 60s while Realtime is confirmed subscribed;
4. fall back to 5s polling only while Realtime is unavailable;
5. preserve the existing printer transport check before every durable claim;
6. do not modify Print Agent V8/V7 executables, queue RPCs, printer routes, payloads, or `send_to_kitchen`;
7. require no reinstall or local configuration change at Smouha or Cleopatra.

Detailed execution and verification are maintained only in:
`docs/WEB_CLOUD_PRINT_REALTIME_WAKE_2026-10-02.md`

## Definition of done
This track is complete only when:
- no 700ms browser Cloud Print claim loop remains;
- browser wake is driven by `cloud_print_wake_state` Realtime events;
- connected reconciliation is 60s and disconnected fallback is 5s;
- same `claim_cloud_print_jobs` / `start_cloud_print_job` / `complete_cloud_print_job` contracts remain unchanged;
- local printer availability is still checked before claiming;
- installed Print Agents require no reinstall or configuration change;
- exact-head Full Verify, DB/security/RLS and Browser Smoke are Green;
- dedicated Smouha/Cleopatra agent activity remains healthy after deploy;
- no Production migration or data rewrite is introduced by this track.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
