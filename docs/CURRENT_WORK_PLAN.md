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
Stop future restaurant sale COGS and FIFO sale-cost reconciliation from crediting finished-goods inventory (1200) when operational consumption is raw materials. Route future sale-side inventory accounting to raw-material inventory (1210) without changing purchase/product-inventory semantics or rewriting historical journals.

## Verified state
- Production diagnosis remains read-only for this repair.
- Recent sale `Johna's-02118` deducted raw-material inventory effects while its journal credited account 1200.
- Last-30-day sale inventory effects are raw-material/inventory-unit based; no product-target sale effect was observed in the read-only scan.
- Account 1200 has accumulated negative balances in both active branches from sale/FIFO postings.
- PR #445 is Draft.
- Verify main #3716 failed only at the mandatory active-worklog structure gate before runtime checks.

## Remaining gated work
- Correct the mandatory worklog structure and rerun exact-head CI.
- Review migration diff and integration implications.
- Do not apply to Production until explicitly approved after CI/review.
- Historical 1200→1210 reclassification remains a separate later phase with its own reconciliation proof.
