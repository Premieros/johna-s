# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Raw FIFO Debt Guardrails**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `bbc866904a05317046b738bde94b9e23dae839cf`
- Active development branch: `development/raw-fifo-debt-guardrails-20261003`
- Mandatory active work log: `docs/RAW_FIFO_DEBT_GUARDRAILS_2026-10-03.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Existing POS/KDS raw-shortage sell-through remains operational; do not introduce a surprise hard block.
- Printing, Print Agent, printer routing and `send_to_kitchen` behavior are frozen.
- No historical stock quantity, sale, purchase, settlement, journal, shift or payment rewrite.

## Current objective
Add safe, branch-aware FIFO debt observability to the existing raw-material current-cost report without changing physical stock or accounting truth.

## Measured Production basis
- 145 raw-material/warehouse locations are currently negative.
- 145/145 negative locations have corresponding outstanding FIFO debt; there are no untracked negative locations.
- 89 negative locations have a known estimate cost; 56 remain genuinely unpriced.
- Current outstanding FIFO debt is approximately 15,427 quantity units across 8,000+ unresolved debt rows.
- Largest current debts include sugar packets and straws; many have no true purchase-receipt history in the same warehouse.
- FIFO settlement is working: fully and partially settled historical debt rows exist.
- Sale, kitchen-send and auto-sale-production intentionally allow raw-material debt; strict stock-count/transfer/manual production paths remain strict.

## Definition of done
- Existing `get_current_raw_material_valuation(uuid)` signature remains unchanged.
- Report rows expose outstanding debt quantity/count, oldest debt, last true purchase receipt, known estimate cost, estimated debt value and deterministic debt status.
- Debt status uses factual conditions only; no arbitrary hard-coded quantity threshold.
- No stock, ledger, COGS, journal, settlement or historical transaction mutation.
- Branch isolation and existing permissions remain unchanged.
- Existing POS/KDS sell-through behavior remains unchanged.
- Unit + integration regression coverage proves debt reporting and settlement visibility.
- Exact-head verify + DB/security/RLS + browser smoke Green before merge.
