# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Raw-material COGS accounting correction**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `08035a784d3c3f43abe68b428c636abb26c004d1`
- Active development branch: `fix/raw-material-cogs-accounting`
- Mandatory active work log: `docs/RAW_MATERIAL_COGS_ACCOUNTING_2026-10-04.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any Production apply requires separate explicit approval.
- Historical journal balances remain out of scope for this phase.
- Preserve branch isolation, Permission-First, Financial Visibility, POS settlement, Printing / Print Agent, KDS / Send to Kitchen, inventory quantities, and shifts.

## Current objective
Stop future restaurant sale COGS from crediting finished-goods inventory (1200) when the sale actually consumes raw materials / operational inventory units. Preserve true ready-product accounting, make refunds reverse the exact inventory account used by the original sale, and make FIFO COGS reconciliation follow the base sale journal without rewriting history.

## Verified state
- Production diagnosis remains read-only for this repair.
- Recent sale `Johna's-02118` deducted raw-material inventory effects while its journal credited account 1200.
- Last-30-day sale inventory effects are raw-material/inventory-unit based; no product-target sale effect was observed in the read-only scan.
- Account 1200 has accumulated negative balances in both active branches from sale/FIFO postings.
- Manual/auto inventory-unit production does not create a finished-goods GL posting, so active restaurant unit consumption belongs with the raw-material value pool unless a sale has an explicit ready-product effect.
- Historical refunds must reverse the same 1200/1210 account used by their original sale.
- PR #445 is Draft.
- Verify main #3716 failed only at the mandatory active-worklog structure gate before runtime checks; later CI heads were superseded by the accounting-lineage refinement.

## Remaining gated work
- Run exact-head Full Verify on the refined migration and integration tests.
- Review final migration diff, refund lineage, FIFO lineage, and rollback.
- Do not apply to Production until explicitly approved after CI/review.
- Historical 1200→1210 reclassification remains a separate later phase with its own reconciliation proof.
