# Modal scroll and mobile navigation
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/modal-scroll-mobile-navigation-20261012`
Current PR: #496
Last updated: 2026-10-12
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED** for production until exact-head Full Verify and owner approval.

## Guardrails
Runtime changes are frontend presentation only. Owner additionally requested preparation to remove repeated kitchen reads. An unwired SQL experiment is now included outside canonical migrations; never execute it on production. No production data, SQL apply, orders, kitchen sends, printer tickets or financial changes. Current user reports follow-up modal/mobile navigation failures after #495.

## Baseline
Main c9247e696c31c662328ac3e83887726877b457f2. #495 exact-head Verify 38272593542 and Pages 38274080699 succeeded. Postmerge Verify 38274080787 still running at scope transition. No unexpected main changes.

## Root-cause ledger
Independent save/restore body overflow in each Modal is unsafe if nested dialogs close out of order. onClose callback changes recreate the old effect, compounding lock ownership instability.
Dialogs rendered inside constrained ancestors can inherit transform/clipping context. Portal to body removes that ancestor constraint.
Fullscreen progress intercepts navigation while route/auth data loads. Compact pointer-events-none status preserves busy feedback without intercepting controls.
Native phone touch behavior still requires device validation; Chromium viewport success alone cannot prove iOS gestures or keyboard behavior.

## Change ledger
Ownership-based shared scroll lock restores original body overflow only after last dialog closes; release idempotent. Stable effect uses latest close callback, Escape only closes top owner.
Shared Modal portals to document.body, bounds and clips panel, scrolls body independently, allows native pan/zoom. Remove backdrop blur and all-property close-button transition.
Global progress uses compact top status, retains bilingual copy/percentage and lifecycle; remove unused animated mark.
Plan selects this single frontend branch. Kitchen production behavior remains unchanged; the separately gated experiment below is not called by any runtime function.

## Verification ledger
Local Node test against exact helper source passed both nested close orders, top ownership, original overflow and repeated release.
Component regressions cover nested lifecycle, latest callback/top-only Escape and portal ancestry.
Browser regressions on 390px and 1366px use mocked categories: long dialog wheel scroll, page stays stationary, close restores body overflow and active-order navigation works. No real API mutations.
React review: stable effect dependencies/cleanup, latest callback ref, no new fetches, existing dialog semantics/labels maintained, native gestures, bounded scroll. No SSR in this Vite SPA.
Local full tests/browser unavailable: runtime lacks React/Vitest and Chromium executable; no such success claimed. CI required on final head.

## Production gate
Exact-head Full Verify green and owner approval required before merge/deploy. User approval for #495 does not apply automatically to #496.

## Next action
Inspect CI and resolve genuine failures. Validate actual phone gesture, keyboard and navigation as remaining device acceptance. No blanket guarantee for custom dialogs that do not use Modal.

## Mandatory update protocol
Read exact HEAD before every sequential write; stop on unexplained changes. Record real results. No cosmetic commits during exact-head verification.

## Owner-requested repeated-read preparation — 2026-10-12
User explicitly requested preparation to eliminate repeated reads while modal verification was running. This expands the draft scope; new exact-head verification replaces the previous frontend-only head results.
Live evidence from read-only inspection: raw FIFO scans target warehouse for SUM(quantity), then scans branch again after deduction; avg-cost guard scans positive batches separately. Smoha sugar packets had 2239 batches (2208 negative). A later read-only EXPLAIN scanned 2240 rows, 371 cached blocks, 22.711ms; one sample, not P95. A naturally occurring send between 15:56:06Z and 15:58:35Z took 1418.885ms with 17644 shared buffer hits and 71 dirtied blocks; block access counts are not HTTP calls, row counts or write statements.

### Experiment
scripts/experiments/kitchen_fifo_single_scan_candidate_20261012.sql defines an UNWIRED, SECURITY INVOKER candidate under a new name. No application-role execute grants, no production function replacement, no new trigger and no automatic migration.
One initial material/branch aggregate supplies target-warehouse running quantity and full-precision branch quantity/value. UPDATE/INSERT RETURNING supplies actual batch changes including BEFORE-trigger debt pricing. Derive final branch totals from those exact deltas, eliminating the second full history scan. Keep canonical FIFO order, lock key, ledger/debt writes and rounding points.
This reduces one repeated full-history aggregate per deduction; it does NOT yet eliminate per-item duplicate raw reads, positive-cost trigger reads, debt creation or prior-cost lookups. No blanket zero-read claim or measured speedup.

### Isolated verification and activation blockers
Rollback-only loopback-DB tests compare exact canonical/candidate outputs, inventory quantity/avg_cost, batches, ledger quantities/costs/before-after and debt quantities: fractional cost, multiple positive batches, prior negative batches, different warehouse, shortage with/without debt, repeated deductions and branch/warehouse rejection. ACL/static tests block accidental production replacement and privilege escalation.
CI must compile and execute the candidate inside BEGIN/ROLLBACK on disposable DB only. No local DB executable is available; no SQL parity success claimed before CI.
Before activation: audit all batch writers for the same material/branch advisory-lock discipline, prove concurrent receipt/count/transfer/void parity, evaluate trigger side effects, and benchmark identical multi-warehouse/high-debt workloads. Without that proof the initial snapshot plus deltas cannot be treated as authoritative under competing writes.
Long-term next preparation: order-scoped grouping/reuse keyed by raw+branch+warehouse, preserving per-item frozen prices/FIFO allocations and atomic idempotency. Avoid stale cross-request caches.
No production SQL activation authorized in this request. Modal runtime changes can be reviewed independently; experiment may remain archived even after a frontend merge.
