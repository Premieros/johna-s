# Performance Root-Fix — 2026-09-24

Repository: `Premieros/johna-s`  
Branch: `development/performance-rootfix-20260924`  
Current PR: `#354`  
Production Supabase: `azzdesuowpdcoflmyezn`  
Published site: `https://premieros.github.io/johna-s/`  
Baseline: `main@3c1aa6047893b5f2e47be575c08e0db8dbd581b5`  
Last updated: 2026-09-24 — worklog Verification ledger heading restored after Run 35983409403

## Work status

Status: ACTIVE — RC-06 Roles refresh stabilization implemented; exact-head verification pending. No Production or printing changes.

Current completed implementation inside PR #354:

1. Inventory Ledger timeout root-fix implemented.
2. Financial journal RLS Super Admin fast-path implemented.
3. Financial Reports stale branch-selector race fix implemented.
4. Regression coverage added for the three items above.
5. Production remains unchanged by this PR.
6. Printing / Print Agent / routing / KDS / `send_to_kitchen` remain untouched.

The current source of truth for all further work is THIS FILE. Conversation memory is informational only and must not be used as the execution source.

## Guardrails

These are hard gates, not recommendations:

- Repository only: `Premieros/johna-s`.
- Production Supabase only: `azzdesuowpdcoflmyezn`.
- Never use or touch `scpovyrqmsbiduanykod`.
- Never edit `main` directly.
- Never force push.
- Permission-First remains mandatory.
- Super Admin is the only implicit bypass.
- Do not weaken RLS, branch isolation, historical visibility, permission checks, or tests.
- Do not reset/reseed/rewrite Production data to make a test pass.
- All migrations are forward-only / append-only.
- No Production migration before exact-head Full Verify Green + explicit Production approval.
- Printing / Print Agent / printer stations / routing / cloud print protocol / KDS / `send_to_kitchen` are frozen and out of scope.
- A test failure must be fixed at the correct layer; business logic must not be weakened to satisfy a bad fixture.
- Before every write/merge: re-check latest `main`, open PRs, and branch divergence.
- Production inspection is read-only unless the Production gate in this file explicitly changes state.

## Baseline

### Repository baseline

- PR #351: merged — report truth/reconciliation and professional exports.
- PR #353: merged — simplified report discovery and explicit report fetching.
- Active root-fix branch created from:
  `main@3c1aa6047893b5f2e47be575c08e0db8dbd581b5`.
- Active PR: #354 — Inventory Ledger / financial RLS / report selector stability.
- No concurrent open PR existed when #354 was opened.
- Current work must re-check this before any next functional write.

### Production latency baseline observed before this repair

Recent authenticated Production sample:

| RPC | Calls | Avg | P95 / Max |
| --- | ---: | ---: | ---: |
| get_income_statement | 15 | 2298 ms | max 5369 ms |
| get_trial_balance | 10 | 1508 ms | max 3381 ms |
| get_general_ledger | 5 | 876 ms | max 3041 ms |
| get_balance_sheet | 5 | 864 ms | max 2075 ms |
| get_cash_flow | 7 | 715 ms | max 1534 ms |
| get_journals | 2 | 192 ms | max 298 ms |
| get_costing_sales_summary | 2 | 104 ms | max 106 ms |

Historical Inventory Ledger incident already reproduced statement timeout / HTTP 500 on `search_inventory_ledger`.

### Important traffic classification

A large 401 wave around 2026-09-24 07:42–07:43 UTC was identified as automated `node` traffic from Boydton hitting RPCs sequentially, not a broad user-session outage.

A separate Realtime 401 from Cairo exists and is not part of this performance root-fix because printing/agent/realtime-print scope remains frozen.

## Root-cause ledger

### RC-01 — Inventory Ledger timeout

Status: CONFIRMED / FIX IMPLEMENTED.

Live Production `public.search_inventory_ledger` evaluated:

- `public.user_may_access_branch(il.branch_id)`
- `private.financial_reference_visible(...)`

inside the hot ledger scan.

The reference helper then dispatched to sale/purchase/expense/customer-payment/supplier-payment visibility and eventually `private.financial_row_visible`, which repeatedly evaluated:

- branch access,
- `history.unlimited`,
- visibility settings,
- business-day cutoff,
- deterministic historical sampling.

This preserved authorization but caused expensive per-row repeated work and matched the previously reproduced statement timeout.

### RC-02 — Income statement / Trial balance / General ledger latency

Status: CONFIRMED / FIX IMPLEMENTED FOR SUPER ADMIN FAST-PATH.

Read-only Production measurement using the same authenticated Super Admin behind slow requests:

- journal aggregate under current RLS: approximately **2031.8 ms**
- same aggregate without row-policy overhead: approximately **10.9 ms**
- inner journal lookup loops observed: **1696**

The expensive plan reopened `journal_entries` from `journal_entry_lines` and re-ran:

- `private.journal_entry_read_visible_by_id`
- `private.financial_reference_visible`
- `public.user_may_access_branch`

for rows even though Super Admin is already the sole implicit bypass.

Conclusion: the root cause is repeated RLS authorization work, not a missing journal index for the measured case.

### RC-03 — Treasury / item / ledger selector stale-branch errors

Status: CONFIRMED / FIX IMPLEMENTED.

`FinancialReportsPage.tsx` could call a selector-dependent RPC immediately after branch/view/type changed while still holding an ID loaded for the previous branch.

This explains live errors such as:

- `TREASURY_ACCOUNT_NOT_FOUND`
- `ITEM_NOT_FOUND`

The same race could affect ledger account selection and party statements.

### RC-04 — 401 wave

Status: CLASSIFIED / NO REPAIR REQUIRED IN THIS WORKSTREAM.

Most sampled 401s were automated `node` requests from Boydton without an authenticated user and touched many RPCs sequentially. They must not be treated as evidence of a user-session failure.

Realtime 401 is tracked separately and remains outside the frozen printing/agent scope.

### RC-05 — PostgREST / Egress growth audit

Status: ACTIVE AUDIT / READ-ONLY.

Trigger:
- Supabase Usage screenshot for 23 Sep 2026 shows approximately:
  - PostgREST Egress: 166.913 MB (78.2%)
  - Realtime Egress: 33.589 MB (15.7%)
  - Auth Egress: 12.879 MB (6.0%)
- Current billing-cycle egress shown: 2.77 GB of 5 GB included.

Audit objective:
1. Measure Production API traffic by route/RPC/table using logs, not UI assumptions.
2. Rank top consumers by response bytes when the log stream exposes response-size fields.
3. Also rank by request count, latency, status, authenticated user, user-agent, and repeating cadence.
4. Separate real branch/user traffic from CI/scanner/automation traffic.
5. Identify repeated polling, duplicate fetches, oversized result sets, and report endpoints that can be reduced without changing business truth.
6. Add only evidence-backed remediation items to this worklog.

Audit safety:
- Production is read-only for this phase.
- No schema/data writes.
- No RLS weakening.
- No print/agent/routing/KDS/send-to-kitchen changes.
- Realtime is measured separately from PostgREST; no realtime/print-agent repair is opened by this audit.
- The screenshot is evidence of service-level volume, but route attribution must come from logs before any optimization.



### RC-06 — Roles refresh amplification

Status: CONFIRMED / NOT COVERED BY EARLIER PERFORMANCE PRs.

Evidence from Production 23 Sep after PR #260/#293 were already merged:
- `/rest/v1/roles`: 6,372 authenticated non-node requests/day.
- One Android WebView user generated 5,224 requests.
- In one sampled hour the same user generated 616 `roles` requests while only ~12 `orders` requests occurred.
- This rules out a whole-app reload loop as the primary explanation.

Code evidence:
- `RolesProvider` depends on the entire Supabase `session` object.
- `AuthContext` intentionally replaces the session object on `TOKEN_REFRESHED` / repeated auth events without rehydrating the profile.
- Therefore role data can be re-fetched on auth token/session object churn even though user identity/role permissions did not change.

Earlier repairs checked:
- PR #260: lightweight shell; did not modify `RolesContext`.
- PR #293: POS/dashboard query churn; did not modify `RolesContext`.
- PR #273: permission/history UI; did not modify `RolesContext`.

Minimal remediation:
- make role bootstrap depend on stable `session.user.id`, not the mutable session object,
- keep explicit `refresh()` after role mutations,
- add a contract test preventing regression to whole-session dependency.

### RC-07 — Auto-close request amplification

Status: CONFIRMED / EARLIER CORRECTNESS FIX EXISTS, FREQUENCY ISSUE REMAINS.

Earlier repair:
- PR #305 fixed the configured business-day cutoff and premature shift closure semantics.

Remaining Production behavior on 23 Sep:
- `try_auto_close_branch_shift`: 3,529 requests/day.
- current `SettingsContext` still runs the RPC every 60 seconds from every logged-in client for every eligible branch.

Conclusion:
- do NOT change PR #305 cutoff semantics,
- frequency/centralization is a separate optimization and must be designed independently.

### RC-08 — POS full snapshot refresh remains after prior coalescing

Status: CONFIRMED / PARTIALLY FIXED EARLIER.

Earlier repairs:
- PR #260 removed full POS active-order snapshot loading from the global app shell.
- PR #293 coalesced simultaneous Realtime bursts and preserves one trailing refresh.

Remaining Production traffic on 23 Sep, after those merges:
- `orders`: 3,094 requests
- `order_items`: 2,740
- `dining_tables`: 2,580
- `get_pos_order_operator_labels`: 1,796
- `order_kitchen_sends`: 1,771

Current design still calls `fetchActiveOrders()` after each Realtime refresh cycle, and that snapshot fetches the active POS data bundle again.

Conclusion:
- keep existing burst coalescing,
- investigate a narrower/shared snapshot or incremental update; do not regress PR #260/#293.

### RC-09 — Dashboard sale_payments oversized failed fetches

Status: CONFIRMED / EARLIER DASHBOARD OPTIMIZATION INSUFFICIENT.

Earlier repair:
- PR #293 narrowed previous-period projection and parallelized payment/item detail loading.

Remaining code:
- `DashboardDataPage.tsx` and `VisualDashboardPage.tsx` still collect up to 5,000 sales then request `sale_payments` with a very large `IN (...)` list and `.limit(20000)`.

Production 23 Sep:
- 286 `sale_payments` GETs observed;
- 258 were errors in the broad sample;
- real browser requests include giant sale-id filters returning 403.

Conclusion:
- existing PR #293 optimization must be preserved,
- payment aggregation/fetch scope needs a separate server-bounded or chunked correction.

## Change ledger

### CH-01 — Inventory Ledger cached visibility context

File:
`supabase/migrations/20260924075209_inventory_ledger_visibility_context_cache.sql`

Implemented:

- keep RPC signature unchanged,
- keep hard 51-row limit and keyset pagination,
- verify `inventory.ledger.view` once,
- verify explicit branch request once,
- materialize accessible branch IDs once,
- materialize `history.unlimited` once,
- materialize recent-window / historical-percent settings once,
- preserve the exact deterministic historical bucket formula,
- reproduce financial reference visibility for:
  - sale / refund / sale_refund,
  - purchase / purchase_return,
  - expense,
  - customer_payment,
  - supplier_payment,
  - fallback ledger references,
- missing references remain fail-closed,
- full server-side search retained.

No inventory mutation behavior changed.

### CH-02 — Journal RLS Super Admin fast-path

Same forward-only migration extends the following SELECT policies:

- `auth_select_journal_entries`
- `financial_visibility_journal_entries`
- `auth_select_journal_entry_lines`
- `financial_visibility_journal_entry_lines`

Implemented statement-level fast-path:

`(SELECT public.is_pos_admin())`

Purpose:

- allow PostgreSQL to evaluate Super Admin state once,
- avoid row-dependent financial/branch helpers for the sole implicit bypass,
- preserve all existing non-admin predicates exactly,
- keep financial visibility policies RESTRICTIVE.

No ordinary-role access was widened.

### CH-03 — Financial report selector context gate

File:
`src/features/accounting/pages/FinancialReportsPage.tsx`

Implemented:

- track a branch/view/party-side/item-type selector context key,
- clear readiness when context changes,
- cancel stale async selector responses,
- normalize account/treasury/item/warehouse IDs to options from the new branch,
- block selector-dependent report RPCs until the current context is loaded.

Affected report views:

- General Ledger,
- Bank / Treasury Statement,
- Item Movement,
- Party Statement.

### CH-04 — Regression tests

Added/updated:

- `tests/unit/inventoryLedgerPerformanceContract.test.ts`
- `tests/integration/inventory_ledger_visibility_context.test.ts`
- `tests/unit/financialJournalRlsFastpathContract.test.ts`
- `tests/integration/financial_journal_superadmin_fastpath.test.ts`
- `tests/unit/financialReportsSelectorRaceContract.test.ts`

Coverage includes:

- Permission-First,
- branch isolation,
- recent history visibility,
- deterministic historical sampling,
- `history.unlimited`,
- Super Admin bypass,
- referenced-row visibility,
- missing references fail-closed,
- financial policies remain RESTRICTIVE,
- stale branch selector RPC prevention.

### CH-05 — Mandatory worklog execution gate

Status: IMPLEMENTED.

Required implementation:

- `docs/CURRENT_WORK_PLAN.md` must declare this file as the Mandatory active work log.
- CI now runs `tests/unit/activeWorklogGateContract.test.ts` as the dedicated **Verify mandatory active work log** step before the normal verification sequence.
- CI fails if the active log is missing, lacks required sections, or the PR branch does not match the branch declared here.
- The gate is wired in `.github/workflows/verify-main.yml`; because `db` needs `verify` and `browser-smoke` needs both, a failed log gate blocks the entire Full Verify chain.
- Every later functional change must update this file before proceeding to merge/Production gates.


### CH-06 — Inventory Ledger contract scope correction

Status: IMPLEMENTED.

File changed:
- `tests/unit/inventoryLedgerPerformanceContract.test.ts`

Change:
- extract only the `CREATE OR REPLACE FUNCTION public.search_inventory_ledger(...)` body from the migration text,
- keep the hot-path regression assertions against that function body,
- continue forbidding:
  - `public.user_may_access_branch(il.branch_id)`
  - `private.financial_reference_visible(`
  inside the Inventory Ledger RPC,
- allow the same financial helper to exist elsewhere in the migration where the Journal RLS policy intentionally uses it.

Intentionally unchanged:
- migration SQL,
- Inventory Ledger behavior,
- RLS policies,
- financial report logic,
- Production,
- printing / Print Agent / routing / KDS / `send_to_kitchen`.

Rollback boundary:
- this commit is test-only and can be reverted without any data/schema/runtime effect.

### CH-07 — Roles refresh stabilization

Status: IMPLEMENTED / VERIFY PENDING.

Files:
- `src/context/RolesContext.tsx`
- `tests/unit/rolesRefreshStabilityContract.test.ts`

Change:
- role bootstrap now keys off stable `sessionUserId` rather than the mutable Supabase session object,
- token refresh / repeated auth session object replacement no longer recreates the role-loader callback,
- explicit refresh after role create/update/delete remains unchanged,
- a `roles` table Realtime subscription refreshes only when role data actually changes,
- cleanup removes the channel on user change/unmount.

Expected effect:
- eliminate the observed `roles` request amplification caused by auth-session churn,
- preserve immediate local CRUD refresh,
- preserve cross-client permission-definition freshness without polling.

Intentionally unchanged:
- role/permission semantics,
- RLS,
- AuthContext token handling,
- user profile hydration,
- printing / Print Agent / KDS / routing / `send_to_kitchen`,
- Production.

Rollback boundary:
- frontend-only; no schema/data change.



## Verification ledger

### V-05 — CH-07 gate-structure failure

Exact head:
`182f703c2b963f7f9427ebab90dcc4e63ed2e9bf`

Workflow:
- Run: `35983409403`
- `verify`: FAILED at **Verify mandatory active work log**
- `db`: SKIPPED
- `browser-smoke`: SKIPPED

Failure:
- mandatory worklog contract could not find `## Verification ledger`.
- no lint/typecheck/unit/build/DB/browser tests were executed for CH-07 on this run.

Classification:
- documentation structure regression only,
- no evidence of a `RolesContext` implementation failure,
- the missing heading is restored before rerunning exact-head verification.

### V-01 — Inventory Ledger implementation head

Earlier exact implementation head completed:

- project identity ✅
- frontend API contract ✅
- lint ✅
- typecheck ✅
- test-suite typecheck ✅
- unit tests ✅
- build ✅
- fresh DB migrations ✅
- schema verify ✅
- Integration / Security / RLS ✅

Browser Smoke had started afterward.

### V-02 — After Journal RLS change

A new exact-head Verify was correctly triggered because previous Green could not be reused after an RLS change.

### V-03 — After selector race fix

A new exact-head Verify was again triggered because the source head changed.

Last observed before mandatory-worklog gate commits:

- lint ✅
- application typecheck ✅
- test-suite typecheck was running.

That run is NOT final anymore because documentation/CI-gate commits change the PR head.

### V-04 — Mandatory gate verification

Status: GATE GREEN / FULL VERIFY RED ON ONE UNIT CONTRACT.

Exact head checked:
`ded8bf2470efe5a8bc682f833d3be5b6b7b4701b`

Workflow:
- Run: `35974822183`
- Job `verify`: FAILED
- Job `db`: SKIPPED because `verify` failed
- Job `browser-smoke`: SKIPPED because upstream jobs did not complete

Mandatory worklog gate result:
- **Verify mandatory active work log ✅**
- Supabase project identity ✅
- frontend API contract ✅
- lint ✅
- application typecheck ✅
- test-suite typecheck ✅

Unit result:
- 204 test files passed / 1 failed
- 1026 tests passed / 1 failed
- failing test:
  `tests/unit/inventoryLedgerPerformanceContract.test.ts`
  → `keeps Permission-First checks while resolving caller context once`

Failure detail:
- the contract asserts the ENTIRE migration file must not contain
  `private.financial_reference_visible(`
- the same migration now legitimately contains that helper in the newly added
  Journal RLS policy block.
- the Inventory Ledger hot scan itself still does not call
  `private.financial_reference_visible(...)` row-by-row.
- therefore this is currently classified as a **test-scope false positive**,
  not evidence that the Inventory Ledger regression returned.

Required next action before Full Verify can proceed:
- narrow the unit assertion to the `search_inventory_ledger` function body / hot-scan scope only.
- keep the Journal RLS occurrence allowed and separately covered by the new
  `financialJournalRlsFastpathContract.test.ts`.

This failure remains recorded and must not be overwritten by a later Green result.

Gate implementation evidence:

- `docs/CURRENT_WORK_PLAN.md` declares the mandatory log.
- `tests/unit/activeWorklogGateContract.test.ts` validates path, required sections, repository/project identity, Production BLOCKED state, and PR branch identity.
- `.github/workflows/verify-main.yml` executes the contract before normal lint/typecheck/unit/build work.
- A failure in the verify job blocks DB integration and Browser Smoke through workflow dependencies.

Current requirement:

- The resulting final PR head must complete the whole Verify pipeline.
- Only the run attached to that final head counts.
- The next work session must record its run ID/result here before any merge or Production action.

## Production gate

State: **BLOCKED**.

Reasons:

- exact-head Full Verify for the final gated head is not yet Green,
- migration has not been approved for Production in this worklog cycle,
- no Production performance-after measurement exists because the migration is not applied.

Production actions currently allowed:

- read-only inspection,
- read-only EXPLAIN/measurement,
- log inspection.

Production actions currently forbidden:

- applying `20260924075209_inventory_ledger_visibility_context_cache.sql`,
- any write/backfill,
- any print/KDS/agent migration,
- merge/apply based on an older Verify head.

To change this section to READY, ALL must be recorded here:

1. latest `main` checked and no unsafe divergence,
2. PR exact head recorded,
3. Full Verify exact-head Green,
4. Browser Smoke Green,
5. no branch/RLS regression,
6. explicit user approval for Production migration.

## Next action

Current mandatory sequence:

1. CH-07 Roles refresh stabilization is implemented.
2. Observe the exact-head Verify and record mandatory-log, unit, build, DB/integration, and browser-smoke results.
3. If CH-07 is Green, measure/design RC-07 auto-close frequency without altering PR #305 cutoff semantics.
4. Then address RC-08 POS snapshot churn while preserving PR #260/#293 optimizations.
5. Then address RC-09 Dashboard sale_payments oversized requests.
6. One coherent change set at a time; update this log before moving to the next.
7. Do not touch printing / Print Agent / routing / KDS / `send_to_kitchen`.
8. Do not merge or apply Production migrations without the existing gate requirements.

## Mandatory update protocol

This protocol is compulsory for every future change in this workstream.

### Before any functional write

1. Read `docs/CURRENT_WORK_PLAN.md`.
2. Read THIS file in full.
3. Confirm repository, branch, PR, Production project, and frozen scopes.
4. Re-check latest `main` and open PRs.
5. Add/update the intended task under `Next action`.
6. If the planned work is not represented here, STOP and update this file first.

### After each coherent change set

1. Add an entry to `Change ledger`.
2. Record exact files/functions/policies touched.
3. Record what was intentionally NOT changed.
4. Record any new risk or rollback boundary.
5. Do not start a separate functional change until this update is committed.

### After each measurement/test

1. Update `Verification ledger`.
2. Record actual result, not expected result.
3. Record run ID / head when available.
4. Failed checks remain visible; do not overwrite failure history with only the later success.

### Before merge

1. Re-read this file.
2. Check latest `main` again.
3. Confirm exact-head Full Verify Green.
4. Confirm Browser Smoke Green.
5. Confirm Production gate state.
6. Update this file with the exact merge readiness decision.

### Before Production migration

1. Exact merged migration identified.
2. Production project ID re-verified as `azzdesuowpdcoflmyezn`.
3. Full Verify evidence recorded.
4. Explicit user Production approval recorded.
5. Rollback/safe response documented.
6. Only then may the Production gate be changed from BLOCKED.

### CI enforcement

The Verify workflow must contain a dedicated active-worklog contract. A PR that fails the worklog contract is not eligible for merge even if lint/tests/build are otherwise Green.
