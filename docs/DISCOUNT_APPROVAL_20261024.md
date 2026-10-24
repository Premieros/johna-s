# Existing checkout discount approval repair
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/discount-approval-20261024`
Current PR: `533`
Last updated: 2026-10-24

## Work status
State: **BLOCKED**
Owner authorized implementing the discount repair, then explicitly canceled changing the calculation or adding a second product path. Scope is only approval application/recovery in the existing checkout. No production change or merge in this preparation.

## Guardrails
Keep existing net-discount/VAT arithmetic, existing API and approval lifecycle. No new RPC, table, column, index, RLS, permissions, SECURITY DEFINER, sale writer, kitchen/stock/printing or installed-agent change. No corrections to historical order 04654/invoice 04872. No automatic payment retry. The abandoned gross-discount draft was discarded locally before any commit/apply/deploy.

## Baseline
Main 8238059d43d26e479e6cd435e23d6913ad0284e0 (#532 released). Bounded production reads confirmed three approved 320 requests were unused for Cleopatra order 04654; invoice 04872 recorded 290. The requesting cashier differs from the order operator and lacks authority to manage other operators' orders. The existing checkout setter requires edit/payment permissions and exact approval, but lacked the scoped payment context already used by settlement. The production ownership guard therefore rejects its order update. Actual invoice arithmetic is consistent with its recorded 290, not the approved 320.

## Root-cause ledger
- Existing set_order_checkout_discount validates actor, branch, amount and subtotal but does not establish the specific payment action context before updating another operator's order.
- Card marks an approval applied before its asynchronous application finishes, then leaves that marker set on failure; it stops polling and offers no retry of the same approval. Read errors are also ignored.

## Change ledger
- Add a temporary exact actor/order/payment context only around the existing validated setter's update/verification. Restore every prior setting on success and exception. Preserve all original authorization, row locking, arithmetic, returned preview and deferred approval consumption by payment.
- Offer a manual recheck/application of the same approval after failure. Do not create a new approval on retry. Surface approval read failure, suppress late decisions for an unmounted/replaced card and lock overlapping approval-request clicks.
- No new discount basis, no change to displayed/recorded discount values or tax calculation, and no modification to process_sale, process_sale_split, sale guards or receipt templates.

## Verification ledger
Seven focused UI/contract tests passed in 1.26 seconds. Owned disposable Postgres proof reproduced the actual failure with the captured production ownership guard, then verified exact approval on another operator's order, unchanged 995−320+14%=769.50 calculation, idempotent preparation retry, missing/mismatched/expired/unauthorized rejection, restored context including error paths, post-write verification rollback, no permission leak, unchanged ACL/security/search_path, and source-guarded rollback. Add a canonical integration regression for the same-owner versus other-operator boundary and permission leakage. Application/test typechecks and focused lint passed. Build passed in 8.21 seconds; identity/API contract checks passed. Full exact-head CI pending final review.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration before owner approval after exact-head checks. Candidate migration changes only the existing checkout setter, with exact normalized-source guard. Rollback restores its exact captured definition. Installed Windows printers stay unchanged.

## Next action
Complete focused/static checks and exact-head CI, then present the narrow existing-path repair for release approval. Do not resume gross-discount work without a new explicit instruction.

## Mandatory update protocol
Reconcile main/head, inspect the deployed setter hash and ACL before any approved apply, and record release results in this PR. Never retry payment or modify a completed invoice to test approval behavior.
