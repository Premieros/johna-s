# Treasury Historical Opening Sequence — 2026-09-27

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/treasury-historical-opening-sequence-20260927`
Base: `main@102dea0d2ebd0f7567217bfbad3c79ba6cdada81`
Current PR: `#394`
Last updated: 2026-09-27 Africa/Cairo

## Scope
- Fix branch treasury daily sequence only.
- First historical treasury row starts from the account opening balance (currently zero for both live branches).
- Historical imported sales are assigned to their source sale date, not delayed journal creation timestamps.
- Treasury activity before the historical import anchor is folded into that first historical row so no real cash/bank movement is lost.
- Every following row carries prior closing balance into the next opening balance.
- Latest closing balance must equal the live cash + bank branch treasury ledger.
- No mutation of historical sales, purchases, expenses, shifts, treasury transactions, or journals.
- Printing / Print Agent / routing / KDS / send-to-kitchen remain frozen and untouched.

## Production audit
- Smouha historical anchors:
  - `HIST-SEP-2026-01-14`: cash 170,036; bank 108,109; credit 8,635.45.
  - `HIST-SEP-2026-15`: cash 6,726; bank 4,778; credit 1,115.
- Cleopatra historical anchor:
  - `IMP-CLEO-HIST-20260920`: cash 229,389.08; bank 182,292.04; unpaid 11,294.85.
- Current branch treasury account opening balances are zero.
- Read-only ledger simulation with pre-anchor folding exactly matched live treasury totals:
  - Smouha cash 78,521.03; bank 184,882.05; total 263,403.08.
  - Cleopatra cash 194,928.11; bank 231,801.92; total 426,730.03.

## Next action
Open a Draft PR and run exact-head verification. Do not apply the Production migration or merge until Full Verify is Green and explicit approval is recorded.

## Change ledger
- Branch created from exact current main.
- Added forward-only migration `20260927215500_treasury_historical_opening_sequence.sql`.
- Historical sale journal timing is resolved from the source sale date in Africa/Cairo; purchase/expense source dates are also respected.
- Any treasury activity before the historical import anchor is folded into the first displayed accounting day.
- RPC now returns canonical `opening_balance`, `day_net`, and `closing_balance` plus cash/bank components.
- Treasury UI renders the server sequence directly; browser-side prior-row reconstruction was removed.
- Regression coverage added to the existing treasury contract suite.
- No Production writes.
- Printing / Print Agent / routing / KDS / send-to-kitchen untouched.

## Verification ledger
- Production inspection: read-only.
- Ledger simulation: exact match to current branch cash/bank balances.
- CI: pending.

## Production gate
BLOCKED — implementation and exact-head Full Verify are pending. Explicit approval is required before Production migration/merge.
