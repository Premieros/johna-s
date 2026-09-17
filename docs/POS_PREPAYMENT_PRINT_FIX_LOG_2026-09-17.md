# POS Prepayment Print Repair — 2026-09-17

## Identity
- Repository: Premieros/johna-s
- Branch: development/pos-prepayment-print-fix
- Production database: azzdesuowpdcoflmyezn
- Production touched: no
- Migration applied to Production: no

## Root cause
The POS prepayment/customer receipt path depends on the canonical `public.get_order_settlement_preview(p_order_id uuid)` RPC so that only sent, unvoided, unsettled kitchen quantities are printable/payable. The repository already contains this function in `supabase/migrations/20260917084500_sent_only_order_settlement.sql`, but read-only inspection of Production showed the function is not currently present there.

## Correction made on this branch
An earlier temporary code change bypassed the settlement RPC and printed from the live cart. CI proved that this violated the existing sent-only receipt contract because unsent additions could be included. That bypass was reverted.

The POS receipt path is now restored to the canonical behavior from `main`:
- uses `get_order_settlement_preview` for active orders,
- preserves `pos.receipt.print` / `pos.payment.take` authorization in the database function,
- preserves branch isolation and order-operator checks,
- preserves sent-only printable quantities,
- preserves `{ authorize: false }` only for rendering after server authorization has already succeeded.

No permission names, grants, RLS policies, role rules, or printer-routing behavior were changed.

## Commits
- d3d4bfde9b30be355344896a598311a4b342d199 — temporary open-order print bypass (superseded)
- e907192a757816aa0d0cf0bc33100c45436e2214 — temporary regression test for bypass (superseded)
- cae1f76b7c10b9903fd5994a1c5c55b38de9c8aa — lint-only correction in temporary test
- 0c65ad1febbaac102e4baf607dc71afacdde2695 — restore sent-only receipt controls and remove temporary bypass test

## Verification status
Before the corrective revert, CI showed:
- database identity: pass
- API contract: pass
- lint: pass
- typecheck: pass
- typecheck:all: pass
- temporary bypass regression test: pass
- existing sent-only receipt contract: failed, proving the bypass was not acceptable

A fresh CI run is required on the corrective commit before this work can be considered Green.

## Remaining production step
Production still needs the already-existing canonical migration/function to be applied before the POS print button can work there. This must not be done until Full Verify is Green and explicit approval is given.
