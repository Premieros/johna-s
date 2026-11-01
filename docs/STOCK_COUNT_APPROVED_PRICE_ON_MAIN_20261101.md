# Approved-price stock count candidate — refreshed on main
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/stock-count-approved-price-on-main-20261101`
Current PR: `#571`
Last updated: 2026-11-01
State: **BLOCKED**

## Work status
Source-only approved-price stock-count candidate rebased onto atomicity-fixed main. No production price migration or November stock count applied.

## Guardrails
Never deploy scripts/candidates SQL without validated production migration. Preserve role/branch/warehouse access, atomic rollback, approved branch price returned by the existing central function (current projection only indexes positive values; never manufacture zero), historical financial records and production inventory.

## Baseline
Atomicity fix PR #570 merged and separately applied to Supabase. PR #569 from older base has conflicts. November count drafts #00008 and #00009 not applied.

## Root-cause ledger
Original apply_count values shortage from FIFO while owner's policy requires last approved branch price. Earlier candidate used a FIFO revaluation bridge; it has now been removed. Raw count issue/receipt calls existing unshipped approved-v2 physical helpers, which value their ledger entries using the existing central approved-price read model.

## Change ledger
PR #571 now stages a FIFO-free raw-count candidate and updates unit/integration test fixtures to install existing v2 helpers only inside a disposable local transaction. Owner direction reaffirmed: reuse the existing latest-price calculation path. Candidate now fails closed with APPROVED_RAW_PRICE_UNAVAILABLE if central pricing has no positive approved price. Replaced the zero-price fixture expectation with an atomic no-write rejection test. No new price calculation engine or price tables created.

## Verification ledger
GitHub Actions run 41292586447: browser-smoke, pages-continuity and db SUCCESS; verify FAILURE due to mandatory active-worklog contract requiring specific section headings and metadata. Worklog structure was corrected; the new head with fail-closed behavior still requires exact-head CI. Local tests have not been independently confirmed in this session.

## Production gate
BLOCKED: candidate SQL explicitly DO NOT DEPLOY, approved-v2 physical helpers are not installed in production and legacy FIFO debt coordinates remain blocked; end-to-end ledger/journal reconciliation remains unverified; no tested production migration, no authorization to apply November counts while ledger and journal revaluation integration and reporting need review.

## Owner architecture decision — no FIFO dependency in final stock count
Owner explicitly requires stock count correction to use the existing approved-last-price path, not a new pricing engine and not FIFO valuation. FIFO is legacy and will be retired after a safe replacement. The candidate no longer calls `_raw_remove_fifo` or `_raw_add` for raw stock lines, but the new movement helpers are unshipped and intentionally reject legacy debt coordinates. PR #571 must not merge/deploy until production cutover and reconciliation gates are met. Separate physical lot/quantity movement from value; use existing `private.latest_approved_raw_prices` for branch/time-specific valuation, with frozen provenance and a balanced stock ledger and journal. Any replacement physical writer must respect existing lots, canonical locks, shortage semantics, rollback, access controls and legacy debt cutover, with no historical replay or data mutation as a shortcut. Reuse the staged default-off v2 movement infrastructure only after proving it works at legacy positions; do not assume v2 is activated or safe on production. Complete local disposable-DB tests of surplus, deficit, multiple lines, missing approved price, historical debt, journal/ledger equality and abort behavior before any migration or production activation.

## Latest verification status
Candidate updated at GitHub commit ec48989eee960751aadd395354bafa88be596491. No passing exact-head CI is available yet for this commit, so tests are NOT claimed green. The candidate must remain DO NOT DEPLOY.

## Owner quantity-only count UX decision
The count document UI and Excel template must capture physical quantities, not manually entered raw-material costs. The existing central price reader is authoritative as of the count document's creation time when posting; old workbook price columns are ignored. Count screens no longer display misleading pre-application valuations from draft line cost. Database `unit_cost` remains as a legacy/audit field and the candidate freezes the posting price there, but it must not be treated as a user-provided pricing authority. Changes staged in PR #571; no production activation or customer count applied. Exact-head UI, workbook, DB and accounting tests are required.

## Production read-only blocker audit — 2026-11-01
- Target counts `Johna's-00008` (407 raw lines) and `Johna's-00009` (402 raw lines) remain `draft`, not approved/applied.
- Existing canonical price read model, evaluated at each count's `created_at`, returned **140 unpriced** raw materials in 00008 and **68 unpriced** in 00009 (unit_cost NULL, source `unpriced`). Valid positive prices: 267 and 334, respectively. Do not mistake returned rows for valid pricing coverage.
- Sources for 00008: pricing 54, purchase 157, stock_count 56, unpriced 140. Sources for 00009: pricing 244, purchase 90, unpriced 68.
- Existing legacy debt table currently has 19,795 open debt rows matching the counted coordinates: 10,585 for warehouse 00008 and 9,210 for warehouse 00009. The approved-v2 helper explicitly blocks those coordinates with `LEGACY_FIFO_POSITION_NOT_CUTOVER`.
- Therefore **release and posting remain blocked on two independent production prerequisites**: creating or recovering authentic approved price events for the unpriced materials via existing authorized workflow, and reconciling/cutting over legacy debt balances without rewriting historical journals. DO NOT invent prices, use stale line costs, bypass historical debt guard, or force draft → applied through privileged SQL.
- UI-only quantity workflow PR #574 passed full CI and merged to main at `25dd4057ab87ef307578f71f6f477d8bf17c1c15`. Financial PR #571 remains source-only and open.

## Owner price policy: zero is zero
A legitimately recorded current raw-material price of 0 must be used as 0 in stock count accounting; do NOT replace it with a fallback or synthesize a positive amount. Distinguish **explicit verified zero** from **missing price** (the `unpriced` sentinel with NULL cost). The existing approved-price projection currently filters zero (`unit_cost > 0`, sync skips `<=0`), and the unshipped approved-v2 movement helpers also reject `<=0`; thus no code path yet proves a legitimate zero through to posting. The 140 / 68 `unpriced` records may NOT be treated as verified zero until a price source explicitly records zero. A compatible change requires extending the existing canonical projection, maintaining source provenance and testing zero-valued receipts/issues, journals and safeguards. Financial PR remains **DO NOT DEPLOY** and counts 00008/00009 remain drafts.

## Next action
Run exact-head CI, fix any integration regression, confirm accounting ledger/report value equality, then prepare audited migration and normal authorized application flow.

## Mandatory update protocol
Update this log after substantive code/test changes. Never claim deployment or post real inventory without verifying the production state.
