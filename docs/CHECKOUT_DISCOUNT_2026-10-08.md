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
Invoker header-only RPC validates order-scoped approval, requester, branch, amount, subtotal and expiry under existing RLS/triggers. Approval consumption remains in process_sale. Also repair the existing sale trigger, which otherwise rejects approved cashier discounts: invoker-only validation of same-transaction consumption audit bound to the unique invoice, requester, branch, amount and order. No new security-definer function or permission bypass. UI awaits persistence and refresh, blocks payment while pending, reports failures.
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

CI c2a69ccb: 1548/1549 unit tests passed; source contract required the normalized monetary expression shape. Retained that contract while rounding approval payloads to cents. Migration made explicitly atomic with short lock/statement timeouts. Re-verification required.

Failed approval persistence keeps payment blocked until a new approval succeeds; rejection/expiry remain explicit decisions. Latest full-unit recheck and fresh-database end-to-end checks are pending; no production migration or merge.

Full Verify 37748475108 at2232621f: frontend1549/1549 and schema/Pages continuity passed; DB951/952 passed. New cashier settlement fixture lacked the pinned inventory warehouse, correctly rejected by production guard. Fixed only test fixture warehouse and sent snapshot; production warehouse guards untouched. Full recheck pending.

Full Verify 37749647121 at e11012ea: all1549 frontend tests passed; all6 new authenticated cashier checkout integration tests passed, including exact invoice discount and replay rejection. DB951/952 passed; the unrelated existing journal_page_read test hit its statement timeout. Recheck required; no production writes.
