# PR4 — Purchases End-to-End — Closure Record

Date: 2026-09-13
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Base: `main@658b86c91a120c7e634250758a38d4895ff72b9a`
Branch: `development/pr4-purchases`
PR: #98

## Scope

`Purchase Request -> Submit/Approval -> RFQ/PO where applicable -> Receive -> Inventory/Ledger -> Supplier/Accounts -> Reports source`

## Proven defect and fix

`receive_purchase_order` could reach GRN/receipt writes before the purchase warehouse was rejected by a later inventory helper. Expected validation failures return JSON, so this could leave receipt-side artifacts after a logical failure.

`supabase/migrations/20260913083000_purchase_receive_atomicity.sql` adds a forward-only preflight before receipt allocation/writes:

- warehouse is required;
- warehouse must be active;
- warehouse must belong to the PO branch;
- no branch/warehouse fallback;
- valid receipts still post only to the PO warehouse;
- the existing PO `FOR UPDATE` lock remains before receive writes.

No existing rows are rewritten, deleted, reset, reseeded, or backfilled.

## Regression coverage

`tests/integration/purchase_receive_atomicity.test.ts` proves:

- missing warehouse fails with zero GRN/stock/journal side effects;
- cross-branch warehouse fails closed;
- valid full receive posts stock only to the PO warehouse;
- AP journal line retains the PO supplier;
- retry after completed receive does not duplicate receipt/stock/journal effects;
- the PO lock remains ahead of writes for concurrent serialization.

`tests/integration/purchase_cancellation_contract.test.ts` proves:

- cancellation before approval is allowed by the current RPC contract and creates no inventory/accounting side effects;
- cancellation after approval is rejected with `BAD_TRANSITION`;
- the test does not force an unrelated list/RLS visibility contract.

Existing procurement regressions continue to cover request creation, approval, PO transition, partial receive, full receive, over-receive rejection, backorders, inventory posting, and accounting effect. Completed purchase invoice editing remains protected by the existing Reverse -> Apply -> Recalculate -> Audit contract and its branch/warehouse/stale-revision regressions.

## Duplicate receive / idempotency decision

No quantity/hash-based dedupe was introduced. Two partial receipts with the same quantity can be legitimate separate physical receipts, and the current API has no independent request idempotency key that could safely distinguish them. Instead, PR4 proves the contracts that are safe and meaningful now: PO-row serialization, over-receive guards, and replay after completed receive being side-effect free.

## Permission / isolation review

- Permission-First remains in force.
- Super Admin is the only implicit bypass.
- Existing drift sentinel keeps operational role names out of Authorization.
- Receive remains branch-scoped.
- Warehouse validation is explicit and fail-closed.
- No cross-branch or cross-warehouse fallback was added.

## UX Acceptance Gate

**UX Acceptance Gate: For every active phase, review affected screens/dialogs for missing required actions, duplicate controls/content, unclear labels/status/help, and unnecessary steps. Apply small behavior-preserving UX improvements within the phase scope. Do not broaden into redesign or alter authorization/business rules.**

For `ReceivingPage` the PR keeps the workflow Arabic-first/RTL, clarifies receiving errors instead of exposing raw codes where touched, and limits the entered receive quantity to the remaining quantity without changing authorization or business rules.

No broad redesign was performed. Unrelated Reports/POS work remains in its planned later stages unless a regression proves a current defect.

## Data protection

- Production was not used as a test environment.
- No Production data write was performed during PR4 verification.
- No reset, reseed, deletion, backfill, or rewrite of user data/configuration.
- Migration is forward-only and append-only.

## Verification

Implementation/test head `6841962e5c65b9356033370d645a13e4cbe1aec5` passed Verify #1241 Full Green:

- locked Supabase identity ✅
- frontend API contract ✅
- lint ✅
- typecheck ✅
- application/test typecheck ✅
- unit ✅
- build ✅
- Fresh DB canonical migrations ✅
- schema ✅
- integration + security/RLS ✅
- Browser Smoke / Playwright ✅

Because this closure record changes the PR head, the final PR head must pass Full Verify again before merge.

## Next gate

1. Full Verify on final PR #98 head.
2. If Green, review mergeability/diff and merge with expected head SHA under the standing stage approval.
3. Verify `main` and GitHub Pages Deploy after merge.
4. Do not start PR5 until the post-merge gates are Green.
