# Treasury Transfer Visibility + Main Bank — 2026-09-27

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/treasury-transfer-visibility-main-bank-20260927`
Current PR: `#0`
Last updated: 2026-09-27 Africa/Cairo

## Work status
State: **BLOCKED**

## Guardrails
- Scope only: daily transfer visibility + organization main bank.
- No historical transaction rewrite.
- No sales, shifts, printing, Print Agent, routing, KDS, or send-to-kitchen changes.
- No direct write to `main`.
- Production apply only after exact-head verification Green.

## Baseline
- PR #395 merged and Production UUID hotfix is applied.
- Daily treasury sequence is live and continuous.
- Existing transfers affect closing balances but are not visible as daily columns.
- Organization currently has main cash only; no organization-scoped bank account.

## Root-cause ledger
- Treasury daily RPC exposes sales/credit/expenses/purchases but not transfer-in/out totals.
- Main treasury UI only selects `scope=organization, kind=main_cash`.
- Branch banks exist, but there is no organization-scoped bank destination for central bank collection.

## Change ledger
- Added forward-only migration `20260927233000_treasury_transfer_visibility_main_bank.sql`.
- Added organization-scoped main bank account using chart code `1030`; branch bank accounts are unchanged.
- Treasury day RPC now returns explicit `transfer_in` and `transfer_out` totals.
- Treasury UI now shows incoming/outgoing transfer columns and displays all organization treasury accounts in the main treasury view.
- Added regression coverage.

## Verification ledger
- Production read-only audit complete.
- CI pending.

## Production gate
State: **BLOCKED**

## Next action
Open PR, run exact-head verification, then apply to Production only if Green.

## Mandatory update protocol
- Re-read branch HEAD and this log before each repository write.
- Record changes and verification results.
- Keep Production gate blocked until exact-head verification is Green.
