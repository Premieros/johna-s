# Checkout discount repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/discount-approval-20261008`
Current PR: #468
Last updated: 2026-10-08

## Work status
Implementation under verification. State: **BLOCKED** for production application.
## Guardrails
Single writer. Preserve RLS, permissions, Financial Visibility, sent items, stock, print, KDS, shifts and historical accounting.
## Baseline
e9b0b5e128fcdb0db8ac1a5b597cae18b6d061e3; prior latest raw-price change #467 deployed.
## Root-cause ledger
Approval updated local discount only; linked checkout re-read unchanged order discount. Cleopatra invoice Johna's-02577 had subtotal55, discount0, tax7.70, total62.70. An unbound approved55 request preceded closure; linkage remains circumstantial.
## Change ledger
Invoker header-only RPC validates order-scoped approval, requester, branch, amount, subtotal and expiry under existing RLS/triggers. Approval consumption remains in process_sale. UI awaits persistence and refresh, blocks payment while pending, reports failures.
## Verification ledger
Local targeted tests 24/24 and full unit/component suite 1549/1549 passed; build passed; lint has 0 errors (15 existing warnings). Application and test typechecks passed. Exact-head Full Verify including fresh-database integration and browser tests running for PR #468. No real sale/send/printing test or production writes performed.
## Production gate
New production function requires separate explicit approval after exact-head Full Verify Green. No historical sale changes authorized on an assumed cash receipt; verify actual amount received first.
## Next action
Complete tests, prepare PR, verify exact head, request concrete production migration approval. Investigate reported costing separately without rewriting immutable FIFO history.
## Mandatory update protocol
Update this log with every implementation/verification transition and reconcile any unexpected head movement.

Cost read evidence: Turkish Coffee S current recipe is 0.012kg coffee at550 +2 sugar packs at0.211 =7.022 (7.02 displayed); catalog manual cost remains0. Need identify which user screen is reported before changing historical cost.

Actual Cleopatra coffee event cost6.60: coffee6.60 and sugar0 (unpriced historical stock). Current recipe7.022 is distinct; do not overwrite historical actual FIFO with latest price.
