# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Post-#402 Stability Closure / no feature development**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `5c74a25448afb65c4e3b528751f749215162cd1b`
- Active development branch: `development/post-402-stability-closure-20260929`
- Mandatory active work log: `docs/POST_402_STABILITY_CLOSURE_2026-09-29.md`

## Closed predecessor
- PR #402 — **merged and deployed**.
- Merge commit: `5c74a25448afb65c4e3b528751f749215162cd1b`.
- Former branch: `development/stability-closure-architecture-containment-20260928`.
- Historical log: `docs/STABILITY_CLOSURE_ARCHITECTURE_CONTAINMENT_2026-09-28.md`.
- PR #402 is not an active execution track and must not be reopened as the working baseline.
- The emergency `order_items.id` transfer/resume/split/Void repair is already present on `main`.

## Active scope
This track closes only post-merge stability exceptions. It does not add product features and does not restart the completed #402 program.

Priority order:
1. P0 Business Day / Auto Close integrity.
2. P0/P1 Order / Payment financial truth.
3. Measured performance closure on remaining Production hotspots.
4. Final containment of the three sensitive heavy pages where safe.
5. Runtime/offline compatibility cleanup.
6. Print lifecycle observability only.
7. Workload-based database performance hygiene.
8. Privileged RPC/security-surface registry.
9. Permanent System Health invariants.
10. Exact-head final verification and stop-before-merge gate.

## Safety fence
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو لا يطابق المسار النشط.
- لا Merge ولا Production migration قبل exact-head Fast Verify Green + Full Verify Green + Production parity Green + موافقة صريحة.
- لا Merge إلى `main` إلا بعد إخبار المستخدم والتوقف لأخذ موافقته الصريحة.
- Single writer on the active development branch.
- No direct write to `main`.
- No force push.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- No weakening Permission-First, branch isolation, RLS, tests, or Super Admin implicit bypass.
- No Production data rewrite/reset/reseed to make tests pass.
- Printing / Print Agent / routing / KDS / `send_to_kitchen` / shifts are sensitive and remain unchanged unless a specific regression is proven.
- Smouha and Cleopatra are live and must remain operational during the work.

## Current objective
Close the residual stability exceptions documented after PR #402, beginning with the verified business-day/date anomaly. Changes must be bounded, measured, branch-safe, and operationally neutral outside the proven defect.

## Definition of done
This track is complete only when:
- business-day advancement is idempotent and cannot skip into a future business day;
- no new fully-settled completed sale leaves its order incorrectly unpaid;
- critical Production paths have branch-specific P50/P95 measurements and duplicate-call evidence;
- remaining heavy-page containment is completed only where operationally safe;
- runtime state has no competing source of truth or polling storm;
- print lifecycle observability is accurate without changing routing/physical-print semantics;
- workload-backed indexes only are retained;
- privileged authenticated RPCs have explicit security contracts;
- System Health detects the listed critical/warning invariants without auto-repair;
- exact-head Fast Verify, Full Verify, Production API parity, and read-only live checks are Green;
- Smouha and Cleopatra remain operational;
- printing and KDS remain unaffected;
- no merge occurs without explicit user approval.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
