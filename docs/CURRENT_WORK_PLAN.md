# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Shift Closing / Treasury Report Reconciliation**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `06f3045de8b47dc59fdee95a0c7e535b81ef8b8c`
- Active development branch: `fix/shift-closing-treasury-report-20261003`
- Mandatory active work log: `docs/SHIFT_CLOSING_TREASURY_REPORT_RECONCILIATION_2026-10-03.md`
- Current PR: `#434`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- No Production DB/schema/migration/data write in this reporting track.
- Sales, payments, treasury journals, printing, Print Agent, KDS, printer routing and `send_to_kitchen` are frozen.
- The report may explain financial truth; it must not mutate financial truth.

## Current objective
Correct the live shift-closing report so collected money, receivables, drawer cash and non-drawer treasury expenses are presented consistently in A4 and thermal output.

## Measured basis
- Smouha shift `c8ff4fae-ceed-4dd3-ae8f-2f63bce55ce0`: net sales 13,421 EGP; cash 3,694; card 9,375; customer credit 352.
- True collected amount is 13,069 EGP; the 352 EGP credit is accounts receivable, not cash/bank collection.
- Two 1,000 EGP expenses were posted from organization `main_cash`, not the cashier drawer; expected drawer 3,694 and actual 3,695 are therefore correct.
- Current A4 labels all 2,000 EGP as cash-drawer expenses, which is misleading.
- Current server adapter computes average ticket from `net_revenue` after expenses; correct average ticket is `net_sales / invoice_count`.
- Thermal text and A4 currently use different semantics for net sales/net revenue.
- Restaurant health was verified read-only before this track: both branches closed cleanly, no open orders, no print backlog/errors, and database locks/idle-in-transaction were clean.

## Definition of done
- Credit/employee-credit appears only as uncollected receivables, not under collected payment methods.
- Collected total equals physical tenders only.
- Average ticket uses net sales before operating expenses.
- Drawer reconciliation shows only expenses that actually affected the cashier drawer; other treasury/bank expenses are shown separately.
- A4 and thermal use the same labels and financial semantics.
- No sale/payment/treasury journal/printing behavior changes.
- Exact-head verify + tests + build + browser smoke are Green before merge.
