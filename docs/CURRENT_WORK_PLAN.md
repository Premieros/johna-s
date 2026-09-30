# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Month-opening raw-material stock count Excel workflow**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `b9e2238cdafcd5b79d6cea73ce80fe6a6ed680fa`
- Active development branch: `development/stock-count-excel-20260930`
- Mandatory active work log: `docs/STOCK_COUNT_EXCEL_2026-09-30.md`

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
4. `development/stock-count-excel-20260930`

All other normal development branches are temporary and should be deleted after verified merge/closure.

## Active PR policy
The two latest Print Agent PRs remain intentionally retained outside this track:
- #365 — Cleopatra V8.1.1 final
- #357 — Smouha V8.1.1 final

The Stability Foundation PR #401 is merged/closed and is not an execution baseline.
The emergency POS line-identity fix is already present on the current main baseline `b9e2238cdafcd5b79d6cea73ce80fe6a6ed680fa` and is historical for this stock-count task.
The active PR is #423 for the month-opening raw-material stock-count Excel workflow.

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
Provide a safe month-opening raw-material count flow for Smouha and Cleopatra without bypassing the canonical stock-count lifecycle:
1. export active raw materials for the selected branch + warehouse from the Stock Counts page;
2. include immutable identity/reference columns and a user-editable counted quantity + optional variance reason;
3. import the same workbook back into the count draft without directly writing inventory or FIFO batches;
4. create the stock-count document through the existing `create_stock_count` RPC only;
5. preserve the existing Draft -> Submit -> Approve -> Apply permission split;
6. on Apply, keep the existing warehouse-aware FIFO adjustment authority and auditability;
7. reject or report invalid, foreign-branch, duplicate, negative, or malformed rows clearly;
8. verify the complete UI + RPC + integration + browser-smoke path before merge;
9. keep printing, KDS, POS, payments, shifts, and unrelated production behavior untouched.

Detailed execution and verification are maintained only in:
`docs/STOCK_COUNT_EXCEL_2026-09-30.md`

## Definition of done
This track is complete only when:
- Excel export is scoped to the selected branch and warehouse;
- upload fills a draft count only and performs no direct stock write;
- zero quantities are valid; negative/non-numeric values are rejected;
- duplicate rows are handled deterministically and reported;
- workbook identity cannot switch a row to another branch/material;
- Draft -> Submit -> Approve -> Apply remains permission-separated;
- apply remains warehouse-aware and FIFO-backed through the existing RPC;
- focused stock-count Excel tests are Green;
- exact-head Full Verify is Green, including DB integration/security and Browser Smoke;
- latest `main` is reconciled before merge;
- no unexpected printing/KDS/POS/payment/shift behavior changed;
- no Production migration or manual stock rewrite is required by this feature.

> Older work plans/logs are archival evidence only unless this file explicitly names them as active.
