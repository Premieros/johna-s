# TREASURY DAILY SINGLE ROW — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/treasury-daily-single-row-20260927`
Current PR: `#385`
Last updated: 2026-09-27 Africa/Cairo

## Work status

State: **IN_PROGRESS**

Goal: simplify Treasury so each business day is exactly one row, while keeping the existing Day Closing Report action unchanged and preserving authoritative treasury balances.

## Guardrails

- Start from latest `main@41714af519a79905e4588d16718aa1387098b39a`.
- No direct write to `main`; no force push.
- Do not touch printing, Print Agent, routing, KDS, send-to-kitchen, POS table binding, or inventory.
- Permission-First and branch isolation remain unchanged.
- No Production migration is planned for the UI-only implementation unless a proven data-contract gap requires one.
- Exact-head Full Verify must be Green before merge.

## Baseline

- Production inspection confirmed there is currently one closed `daily_closes` row per branch/business_date; repeated visual rows come from rendering movement details under the day.
- The current day-close reconciliation RPC already returns sales by cash/bank/credit, expenses, cash purchases, close balances, post-close treasury movements, and current balance.
- Smouha 2026-09-26 snapshot example: sales 22,803; credit 275; expenses 1,395; cash purchases 4,345.99; cash sales 14,196; bank/card 8,332.
- Day Closing Report button currently calls the canonical `fetchDayClosingReportServer` and must remain unchanged.

## Approved row contract

One visible row per business day:
- Date
- Opening balance
- Sales
- Credit
- Expenses
- Purchases
- Day net = Sales - Credit - Expenses - Purchases
- Cash
- Bank
- Closing balance
- Day report action

Treasury deposits, withdrawals, transfers, and other balance movements remain visible in Treasury movement history and must explain differences between day rows. The latest displayed closing balance must reconcile to the live branch treasury balance.

Main treasury:
- Provide a clear Branch Treasury / Main Treasury switch.
- Main Treasury view shows its own balance and transaction movement history.
- No business-day sales rows are fabricated for the organization-level main treasury.

## Change ledger

- Created isolated branch from exact latest main.
- Production inspection completed read-only.
- Implemented one compact DataTable row per business day in `TreasuryPage`.
- Approved columns are rendered directly from the canonical day-close reconciliation payload.
- Day net is calculated as Sales - Credit - Expenses - Purchases.
- Latest closing balance is bound to the live branch treasury cash+bank balance.
- Existing Day Closing Report action remains on `fetchDayClosingReportServer` unchanged.
- Added Branch Treasury / Main Treasury scope switch.
- Main Treasury movement history filters transactions by the organization-level main treasury account.
- Removed expanded per-day movement rows from the day summary; treasury deposits/withdrawals/transfers remain visible in the treasury movement table.
- Added unit contract coverage preventing regression to multi-row per-day rendering.

## Verification ledger

- Baseline DB inspection: read-only, no duplicate branch/business_date closes found.
- Focused/unit verification: pending on PR #385 exact head.
- Full Verify: pending.

## Production gate

State: **NO_DB_CHANGE_PLANNED**

No Production SQL write is authorized or required by the approved UI-only scope.

## Next action

Run exact-head verification for PR #385. Fix only proven failures; do not merge until Full Verify is Green.
