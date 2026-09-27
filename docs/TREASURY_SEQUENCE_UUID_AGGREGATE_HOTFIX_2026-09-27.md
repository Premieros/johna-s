# Treasury Sequence UUID Aggregate Hotfix — 2026-09-27

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/fix-treasury-sequence-uuid-min-20260927`
Current PR: `#0`
Last updated: 2026-09-27 Africa/Cairo

## Work status
State: **BLOCKED**

## Guardrails
- Fix only the treasury daily summary runtime error.
- No historical data mutation.
- No printing / Print Agent / routing / KDS / send-to-kitchen changes.
- No direct write to `main`.

## Baseline
- PR #394 merged and its Production migration is applied.
- Treasury account balances load, while the daily summary is empty.

## Root-cause ledger
- PostgreSQL has no `min(uuid)` aggregate.
- The RPC used `min(a.reference_id)` where `reference_id` is UUID.
- Production reproduction returned SQLSTATE 42883.

## Change ledger
- Added forward-only RPC replacement using `min(a.reference_id::text)::uuid`.

## Verification ledger
- Production root-cause reproduction confirmed.
- CI pending.

## Production gate
State: **BLOCKED**
- Requires exact-head verification Green before apply.

## Next action
Add regression coverage, open PR, run exact-head verification, then apply only after Green.

## Mandatory update protocol
- Re-read branch HEAD and this work log before each repository write.
- Record changes and verification results here.
- Keep Production gate blocked until exact-head verification is Green.
