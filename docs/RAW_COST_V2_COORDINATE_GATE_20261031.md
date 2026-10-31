# Raw cost v2 coordinate routing — 2026-10-31
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `feat/raw-cost-v2-coordinate-gate-20261031`
Current PR: #561
Last updated: 2026-10-31
State: **BLOCKED**

## Work status
Owner authorizes completing root replacement for FIFO historical replay and low-storage approved-price costing. PR #560 is merged to main but **only candidate SQL**; neither v2 schema nor helper is installed on production. This PR implements one tiny default-OFF coordinate routing candidate and safety regression, NOT live activation.

## Guardrails
No business-row writes to production. No big 717-debt synthetic fixtures. No irreversible FIFO debt deletion, historic journal rewrite, wrong expiry metadata or unaudited posting. No direct authenticated mutation of v2 gate. Any coordinate with a legacy negative batch or unsettled FIFO debt MUST remain on legacy writer pending audited conversion; default OFF for ALL coordinates and no activation by merge. Any receipt with lot production/expiry/batch metadata fails explicitly until a release supports it.

## Baseline
Source is main commit `c46f017bdf292692da8098ba7382eabbcdab69c6` (PR #560 merged). Live state was confirmed: no v2 function, no approved-cost ledger column and no direct activation, transfer #00008 pending and without ledger rows. Aggregate legacy backlog: 20,263 open debt lines across 146 warehouse-material coordinates; negative batch quantity equals open debt quantity (29,553.8287) on read-only preflight. For Smouha espresso 717 debts, including 94 estimated and 623 unestimated. Original cost source is `private.latest_approved_raw_prices` (branch-specific).

## Root-cause ledger
Production transfer receipt synchronously calls FIFO debt settlement and modifies historical kitchen / sales COGS entries. Even 120-to-1 batch write change improved the synthetic representative case 953→852ms (~11%) but does not guarantee under 30s or remove 473 old sale updates. Per-issue OV batch + raw_fifo_debts grows storage and retroactive revaluation overhead.

## Change ledger
- `scripts/db/candidates/approved_raw_cost_v2_coordinate_gate_20261031.sql`: one small private activation row per material/branch/warehouse; source-drift-guarded routing at original `_raw_add` / `_raw_remove_fifo` advisory lock boundary; v2 only if activation row present, legacy behavior unchanged otherwise. New activation table defaults EMPTY, with no direct public roles privileges.
- Explicit v2 fail-closed for lot receipt metadata until expiry provenance is implemented, for non-negative-only issues lacking stock, and for coordinates with legacy debt (existing helper guard).
- `tests/integration/approvedRawCostV2CoordinateGate.test.ts`: tiny rollback-only fixture (one inactive legacy issue, one activated issue and one receipt) proves separation, approved price, zero new debts, one aggregate shortage, balanced receipt variance, unsupported lot error and private ACL.
- `scripts/db/read_only/raw_cost_v2_legacy_cutover_preflight_20261031.sql`: grouped read-only view of historical debt/negative batch parity and current price availability; never claims past invoice price from today's prices. Does not mutate or activate stock.
- No existing release migration; no production SQL.
- NOTE: enablement requires a **separate** accounting-approved release that integrates all raw movement writers (including returns), closed periods, expense/COGS rules, reversal idempotency, kitchen snapshot and batch expiry metadata. An empty gate is not a production rollout.

## Verification ledger
PR #560 prior exact-head CI #4569 passed; 215 DB integration files / 1,180 tests (2 v2 tiny tests) and all four jobs. No new PR CI result yet. SQL source anchors need match checks and tiny full CI, done only on disposable GitHub Postgres 16. Production readings are aggregate and read-only. Do not report as a fixed live transfer #00008.

## Production gate
**BLOCKED** by legacy 20,263 open FIFO debts, old journal valuation, v2 API caller security/authorization, receipt lot metadata and reversal/returns, and end-to-end transfer/production/sale parity. Production coordinate activation never runs in this PR; verified exact-head CI is mandatory even to merge inactive source files.

## Next action
Run the one-small-fixture DB test. Fix routing/ACL failures if necessary. After CI, stage only inactive source files, do not apply to production. Implement per-coordinate legacy financial reconciliation, locked/closed-period and idempotent reversal before any real v2 activation. No additional 717-row CI bench.

## Mandatory update protocol
Update this log after every verification, PR merge, production read-only check, or release decision. CI must fail when mandatory worklog is missing. No Merge or Production migration before the applicable safety gate. Production inventory and historic journals stay intact.
