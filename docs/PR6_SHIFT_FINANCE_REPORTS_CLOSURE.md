# PR6 — Shift / Finance / Reports — Closure

Date: 2026-09-13
Repository: `Premieros/johna-s`
Production Supabase ONLY: `azzdesuowpdcoflmyezn`
Branch: `development/pr6-shift-finance-reports`
PR: #100
Baseline: `main@7aa3c8da660775139a6f609e6c345cca1d46b9a3`
Code-complete head before closure docs: `4fe7a104e0618d77abb23398f02f1d3f2bf5f733`

## Scope closed

PR6 audited and hardened the shift-close, financial-reporting, and operational-reporting paths without changing historical business data or Production schema.

## Proven deviations and fixes

### 1. Operational reports were not compact/tabular

`ReportsPage` still rendered chart visualizations even though the accepted reporting contract is compact/tabular with filters and exports.

Fix:
- removed embedded operational report charts;
- preserved report queries, totals, tables, contextual filters, branch context, saved/custom reports, Excel/CSV export, and print actions;
- added `tests/unit/reportsCompactTabularContract.test.ts`.

### 2. Open-shift expected cash displayed a stale stored value

For an open shift, `shifts.expected_amount` is not the live drawer authority. `get_active_shift` derives the live expected cash from `shift_operations`, while `close_shift` recomputes the same movement categories at close.

Fix:
- `ShiftsPage` now resolves live expected cash through `get_active_shift` for open shifts;
- close defaults, open-shift banner, and open-row display use the live expected value;
- `shiftClosingFinancials.ts` derives live open-shift expected cash from the same shift-operation categories used by server close logic;
- changed the misleading label for `expected - opening` from cash sales to net drawer movement.

Regression coverage:
- `tests/unit/shiftLiveExpectedContract.test.ts`;
- `tests/integration/shift_live_expected_consistency.test.ts`.

The integration scenario proves:
- opening cash = 100;
- cash sale = +120;
- card sale = +50 but does not enter drawer cash;
- cash-in = +30;
- cash refund = -10;
- cash expense = -20;
- cash-out = -5;
- live expected drawer cash = 215;
- `close_shift` expected = 215;
- closing with actual 215 stores difference = 0.

### 3. Financial report branch selector did not support multi-branch users correctly

Financial RPCs are branch-specific. The page previously exposed branch selection only through a Super-Admin UI condition, while `useBranchFilter()` intentionally returns `null` for users with multiple RLS-visible branches. This could leave legitimate multi-branch managers/accountants at a branch-selection placeholder with no usable selector.

Fix:
- removed role-name-based financial report branch selector logic;
- any user with more than one RLS-visible branch can select one of those visible branches;
- no unsupported "all branches" option is offered for single-branch financial RPCs;
- selecting a report branch does not broaden access because the branch list remains RLS/user-branch-access scoped.

Regression coverage:
- `tests/unit/financialReportsBranchScopeContract.test.ts`.

## Existing financial contracts verified and preserved

The PR6 audit confirmed existing coverage for:
- sales attribution by employee through `sales.cashier_id`;
- shift operation attribution through `shift_operations.created_by`;
- correct attribution after controlled order-operator transfer;
- split tender totals matching sale totals;
- split tender rows persisted individually to both `sale_payments` and `shift_operations`;
- tender mismatch fails without creating a sale;
- shift cash ledger is client read-only and server RPC written;
- financial report RPCs run as SECURITY INVOKER under caller RLS context;
- restricted accounting/reporting users remain callable inside their allowed branch scope;
- customer/supplier/accounting report paths remain unchanged unless already covered by existing tests.

No accounting business rule was changed merely to enlarge PR6 scope.

## UX acceptance gate

Touched reporting and shift-closing surfaces were reviewed for:
- compactness and removal of duplicate visual reporting;
- branch context clarity;
- misleading labels;
- open-shift close amount correctness;
- preserving Arabic-first/RTL behavior;
- preserving export/print/filter actions;
- preserving Permission-First and RLS scope.

No broad redesign was introduced.

## Data and Production impact

- No Production manual write.
- No migration added by PR6.
- No RLS weakening.
- No user/business data deletion, reset, reseed, backfill, or balance rewrite.
- No change to Production Supabase during PR6 implementation/testing.

## Verification checkpoint

Code-complete head: `4fe7a104e0618d77abb23398f02f1d3f2bf5f733`
Verify #1261: **FULL GREEN** ✅

Passed:
- repository identity lock ✅
- frontend API parity ✅
- lint ✅
- application typecheck ✅
- test-suite typecheck ✅
- unit tests ✅
- build ✅
- Fresh DB canonical migrations ✅
- schema verification ✅
- integration/security/RLS ✅
- shift live expected numerical regression ✅
- Browser Smoke / Playwright ✅

Closure documentation changes the PR head, so one final Full Verify on the documentation-complete head is required before merge.

## Merge gate

After the final documentation-head Verify is Full Green:
1. refetch `main` and PR #100 head;
2. confirm mergeability and no newer conflicting work;
3. mark PR #100 ready;
4. merge with expected-head protection;
5. verify post-merge `main` and Deploy;
6. only then begin PR7 Confirmed Legacy Cleanup.

Separate track: PR #78 Premier Print Agent remains independent and is not part of PR6.