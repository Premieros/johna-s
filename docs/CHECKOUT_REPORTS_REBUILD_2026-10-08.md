# Checkout and reports rebuild — 2026-10-08
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/split-discount-reports-20261008`
Current PR: #472
Last updated: 2026-10-08

## Work status
State: **BLOCKED** pending exact-head Full Verify. User authorized work after the previous writer finished.

## Guardrails
Single writer. No direct main writes, force pushes, permission/RLS weakening or SECURITY DEFINER shortcuts. Preserve printing, KDS, inventory, accounting and shifts.

## Baseline
Main 8f1041fb (merged #470 historical costing and #471 serialized reporting reads).
Production function definitions read and pinned before preparing repair.

## Root-cause ledger
Smoha Table48 Johna's-02447: 190 subtotal,40 discount,150 due; open/unpaid.
Two approvals consumed with split audit shape but no invoice proof. guard_sale_discount requires invoice_number, so split core can reject. Early JSON failures commit approval consumption although no sale was created. Split also compared percentage approval metadata against its normalized amount type. Direct UI discount changes can be discarded by confirmation reading only the server preview.

## Change ledger
Invoice proof added only to split approval audit. Failed split/normal settlement returns unwind all writes via a nested exception block, returning the original structured failure. Direct-discount users persist and verify checkout changes before payment. Existing stock/accounting/print routines retained.

## Verification ledger
New integration tests: split success, percentage approval normalized to money, mismatch rollback, warehouse failure rollback, normal failure rollback. 1564 frontend tests passed; 10 checkout-scope regressions passed; production build passed; application/test typechecks passed; changed-file lint has no errors. Initial CI frontend/build passed; fresh-DB guard identified known canonical/live process_sale drift (guard placement, no-sent error and direct type). Repair now pins both exact baselines and preserves each baseline outside the three atomicity edits. Local PostgreSQL unavailable; full fresh-DB verification required in CI.

## Production gate
No migration applied. User approved fixing checkout; exact-head Full Verify Green required before concrete guarded apply. No real sales or prints executed by agent. Historical closed invoices are audit-only until evidence and correction approval.

## Next action
Complete checkout regression CI and apply verified repair. Continue reporting rebuild in staged PRs under the agreed ordered backlog.

## Mandatory update protocol
Record verification transitions and exact head. Reconcile unexpected main movement. Update this log before every mutation scope change.

## Reporting backlog
1. Checkout discount closure repair.
2. Canonical report sources, row grain, sale/refund/discount/tax/status rules.
3. Core report families and approved accounting templates.
4. Shared branch/period/business-day filters and compatible dimensions.
5. Shared configurable table: search, sort, per-column filters, order, widths, pinning.
6. Explicit column aggregation: sum, first/last balance, weighted averages and ratios.
7. Detail/summary/pivot/chart and multilevel grouping.
8. Executive report, prior periods, YoY/YTD; targets later.
9. Drill-down to invoices, tenders, items, movements and journals.
10. Preserve current/recorded/historical-corrected cost distinctions.
11. Historical station/category strategy and audit reports/closing snapshots.
12. Named personal/shared views with permission checks.
13. Bounded server reads, export jobs, freshness/completeness evidence.
14. Consistent Excel/PDF/print and device share.
15. Sales/collections first, then other domains; reconcile totals and regressions.
