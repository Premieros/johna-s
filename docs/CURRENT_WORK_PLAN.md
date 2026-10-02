# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **POS financial safety hardening**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `746b0538b55de88173d0d070d9ff54ca8ea31f42`
- Active development branch: `development/pos-financial-safety-hardening-20261002`
- Mandatory active work log: `docs/POS_FINANCIAL_SAFETY_HARDENING_2026-10-02.md`

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
4. `development/pos-financial-safety-hardening-20261002`

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
Harden the POS financial write path against duplicate/replayed operations without changing established kitchen, FIFO, printing, shift, or accounting truth:
1. block same-tick duplicate checkout before the first async boundary;
2. keep the same logical operation identity across ambiguous retries;
3. make normal and split sale retries idempotent on the server;
4. keep offline replay owner-safe and idempotent;
5. fix the offline pending counter so delayed/blocked rows never disappear from operator visibility;
6. Production idempotency migration is applied and verified; merge/deploy remains blocked until fresh exact-head Full Verify Green and explicit merge approval.

Detailed execution and verification are maintained only in:
`docs/POS_FINANCIAL_SAFETY_HARDENING_2026-10-02.md`

## Definition of done
This track is complete only when:
- same-tick duplicate checkout is blocked synchronously in both direct and linked/offline flows;
- same operation-key concurrent/retry calls create at most one Sale and one accounting effect;
- active POS and offline replay callers use the idempotent server contract;
- blocked/dead-letter/backoff offline rows remain included in the pending count;
- exact-head Full Verify is Green including DB/security/RLS and Browser Smoke;
- no Production migration is applied before explicit approval;
- post-deploy read-only integrity checks remain at zero for duplicate invoices, duplicate kitchen sends, linked-sale shells, split-payment mismatch, and unbalanced journals.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
