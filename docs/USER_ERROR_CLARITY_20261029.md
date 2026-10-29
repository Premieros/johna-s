# Understandable operational errors
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/user-error-clarity-20261029`
Current PR: #546
Last updated: 2026-10-29

## Work status
State: **BLOCKED**
Implementing owner-authorized error-message clarity; no deployment yet.

## Guardrails
Frontend only, no migrations or production writes/tests/prints/replays. Preserve all POS authorization, quantity/transfer identity, financial, stock and print algorithms. No automatic retry or polling. No raw SQL/stack/secrets in visible messages or telemetry. One sequential writer. Unrelated test-branch and item-category configuration remain unchanged.

## Baseline
Main0e665fc91c54a46c5156909668d1b8d3f59d5ed0, tree8237ce6b95d2fb21f7813ab3de45081b53bb560c; #545 remains released.

## Root-cause ledger
Today115 bounded telemetry events:44 missing preparation routing;43 unavailable-order responses tied to completed/cancelled rows;11 transaction wrappers obscure actual causes. Existing Toast drops type/reference; missing mapping turns setup code generic; persistence passes only wrapper code to telemetry although detail exists; generic text incorrectly guarantees no write even with unknown outcomes. This scope does not claim to fix the underlying eleven save failures or guess unknown historical SQL detail.

## Change ledger
Translate station setup, cancelled/completed states, technical/connection failures; show bilingual category and correlation reference. Preserve nested safe cause identifiers through existing telemetry RPC only; do not persist raw details or schema. Keep custom friendly messages. One RLS-filtered status-only read after ORDER_NOT_FOUND; never after permission rejection and no closed-order hydration. Unknown/network outcomes require checking operation before retrying. Error toast remains9s for reading; other messages3.5s.

## Verification ledger
77 focused checks passed across8 files: user-facing mappings, nested cause telemetry/privacy, Toast reference linkage, ended-order authorization, cart recovery and settlement scope. App/test types and build passed; lint has no errors (one existing hook dependency warning). API contract unchanged171RPC/56tables. Exact-head four-job CI required before release. No production incident reproduction or printer tests.

First exact-head CI passed1157 DB/RLS tests and136 browser checks plus Pages continuity. Frontend1965 passed/2 failed: two old expectations required the previous generic wording and telemetry call without correlation. Update those expectations to the new outcome-uncertainty wording and linked reference; retain query-error rows/hasMore behavior and centralized telemetry assertions. Application source unchanged. Fresh exact-head CI required.

## Production gate
لا Merge ولا Production migration before separate final owner release approval and exact-head verification. No database change included. Rollback by reverting this frontend candidate.

## Next action
Finish focused checks, publish candidate and exact-head CI; present concrete result for release approval.

## Mandatory update protocol
Update this log and unified plan when scope changes; maintain a final PR verification/release ledger before merge. Never treat old or skipped checks as exact-head proof.
