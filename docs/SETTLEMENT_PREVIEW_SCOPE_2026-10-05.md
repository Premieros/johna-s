# SETTLEMENT PREVIEW SCOPE — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/settlement-preview-scope-20261005`
Current PR: `#451`
Last updated: 2026-10-05

## Work status
State: **BLOCKED**
Isolated frontend fix under verification. Production unchanged.

## Guardrails
No role-name authorization, permission/RLS/Financial Visibility change, DB migration or business-data writes.
Preserve process_sale, operation idempotency, stock posting, settlement formulas, receipts and Print Agent.
No merge before exact-head Full Verify Green and explicit approval.

## Baseline
main b4929aa06a5c5b2d8734750f2fad42c30af9d464, #450 merged and approved Production guard repair applied.
Production SELECT confirms order 6497fefa-e9bd-4f34-8a1a-3ce28e90c88c and its final sale use Cleopatra warehouse 94d6d447-b910-43d5-b525-87814dd905e1.
Final payment occurred 2026-10-05 12:41:46 Cairo. No default-setting modification.

## Root-cause ledger
Checkout preview state had no order/branch scope invalidation or superseded-read guard.
Confirmation reused cached preview warehouse with current order/branch identifiers.
This is a proven code defect and plausible explanation of the reported attempts, not proof of their exact payloads.
Generic CLIENT_ERROR events lack sufficient evidence to attribute sosy errors to this issue.

## Change ledger
Scoped preview hook clears before paint, validates server order/branch and discards superseded/closed reads.
Confirmation reads current authoritative sent-only preview instead of the cached warehouse.
Preserve manual unsent-item warning and the existing server-bound totals/payload/printing.
One additional read per linked online confirmation; no polling or extra write.

## Verification ledger
Focused hooks and sent-only contract: 3 files / 12 tests passed.
Actual payment-hook tests assert fresh warehouse forwarding and foreign preview never reaches process_sale.
Full unit/component suite: 290 files / 1418 tests passed.
Typecheck:all, production build and API contract passed; changed-file lint has zero errors and two pre-existing warnings.
Remote exact-head CI pending.

## Production gate
State: **BLOCKED**
Frontend draft only; no database apply included.

## Next action
Complete exact-head CI. #450 is merged/applied after explicit approval and verification. This frontend patch requires its own exact-head CI.
Review diagnostic evidence for generic CLIENT_ERROR without exposing raw secrets or changing issue RPC implicitly.

## Mandatory update protocol
Single writer; reconcile main/head before every remote write. No direct main write or force push.
