# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Web Cloud Print realtime wake hardening**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `04ed847f726049f87055eafba079ce51e7cb2db4`
- Active development branch: `hotfix/web-cloud-print-realtime-wake-20261002-r2`
- Mandatory active work log: `docs/WEB_CLOUD_PRINT_REALTIME_WAKE_2026-10-02.md`

## Reconciled predecessors now on main
- PR #428 — POS financial safety hardening — is merged on `main` at `84f4a1d78dcbe9f637f1e19d26b33de24592da73`.
- PR #429 — supplier payment allocation subledger — is merged on `main` at `04ed847f726049f87055eafba079ce51e7cb2db4`.
- Their POS/offline/idempotency and supplier-allocation files are inherited from latest `main` unchanged by this track.
- This print-load track must not regress POS idempotency, supplier allocations, KDS, FIFO, shifts, accounting, or installed Print Agent behavior.

## Repository branch policy
Long-lived branches intentionally preserved:
1. `main`
2. `development/cleopatra-v811-final`
3. `development/smouha-v811-realtime-final`

Current temporary active development branch:
4. `hotfix/web-cloud-print-realtime-wake-20261002-r2`

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
- No Production data rewrite/reset/reseed to make tests pass.
- Installed Print Agent executables/configuration are frozen; no reinstall is required or permitted by this track.

## Current objective
Reduce historical browser Cloud Print polling/log load without touching installed restaurant Print Agent programs:
1. replace the browser 700ms durable-queue polling loop with existing branch-filtered `cloud_print_wake_state` Realtime wake;
2. retain immediate initial drain of already-pending jobs;
3. reconcile every 60s while Realtime is confirmed subscribed;
4. fall back to 5s polling only while Realtime is unavailable;
5. preserve the existing local printer transport check before every durable claim;
6. keep the same `claim_cloud_print_jobs` / `start_cloud_print_job` / `complete_cloud_print_job` contracts;
7. do not modify Print Agent V8/V7 executables, installers, local configuration, printer routes, payloads, migrations, or `send_to_kitchen`;
8. require no reinstall at Smouha or Cleopatra.

Detailed execution and verification are maintained only in:
`docs/WEB_CLOUD_PRINT_REALTIME_WAKE_2026-10-02.md`

## Historical reconciliation boundary
- The supplier allocation work from PR #429 is already on latest `main` and remains untouched by this track.
- The confirmed legacy `الفريدة` discrepancy is not mutated here.
- No supplier payment or allocation data is changed by this print-load track.

