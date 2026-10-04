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
- Single writer on the active branch; no direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- No merge and no Production migration before exact-head verification and explicit approval.
- Historical journal balances are out of scope for this phase.
- Preserve branch isolation, Permission-First, Financial Visibility, POS settlement, Printing / Print Agent, KDS / Send to Kitchen, inventory quantities, and shifts.

## Current objective
Stop future restaurant sale COGS and FIFO sale-cost reconciliation from crediting finished-goods inventory (1200) when the actual operational consumption is raw materials. Route future sale-side inventory accounting to raw-material inventory (1210) without changing purchase/product-inventory semantics or rewriting historical journals.

## Verified Production evidence
- Recent sale `Johna's-02118` deducted only raw-material inventory effects.
- The same sale journal debited COGS (5000) and credited finished-goods inventory (1200).
- Last-30-day sale inventory effects are dominated by raw materials; no sale product-target effects were observed in the read-only check.
- Account 1200 has accumulated credit balances in both active branches from sale/FIFO postings.
- No Production changes have been made for this repair.

## Current implementation
- New migration routes sale/refund/fifo COGS inventory legs from `inventory_fg/1200` to `inventory_rm/1210` at journal-post resolution.
- New FIFO reconciliation journals use raw-material inventory.
- Existing historical FIFO reconciliation journals retain whichever inventory account they already use, preventing mixed-account updates.
- Purchase and stock-count reference types are not remapped.
- No historical backfill/reclassification is included.

## Remaining gated work
- Run exact-head CI.
- Review migration diff and integration implications.
- Do not apply to Production until explicitly approved after CI/review.
- Historical 1200→1210 reclassification remains a separate later phase with its own reconciliation proof.
