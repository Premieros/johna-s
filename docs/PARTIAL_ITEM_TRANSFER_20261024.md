# Safe partial item transfer
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/partial-item-transfer-20261024`
Current PR: `534`
Last updated: 2026-10-24

## Work status
State: **BLOCKED**
Owner authorized implementing quantity transfer with an explicit rollback after reviewing the earlier wrong-line/reprinting repairs. Prepare and verify this candidate; no production migration, merge, deployment, live order mutation or live printing in this work.

## Guardrails
Preserve #407 and #421 exact persisted line IDs; never group moved rows by product/configuration. Existing installed Windows agents, print enqueue/idempotency, kitchen send implementation, sales writers, pricing rules outside exact transfer allocation, financial formula, permissions and RLS remain. New helpers and JSON-payload overload are invoker functions. Existing definer functions retain their security modes, ACLs and search paths. Do not combine the isolated Windows experiment or the separate test-table-name fixture branch.

## Baseline
Main `252c20b1ed61a784d84fcf752681194afeaa3b58` (#533 released). Read-only production function metadata captured in partial_transfer_baseline.json and partial_transfer_extra_baseline.json. Existing 3-argument transfer takes whole line IDs only. The modal removes whole selected cart rows on completion. Its current behavior cannot express 1 of 3.

## Root-cause ledger
- Whole-row transfer contract/UI, not an inventory shortage, explains the quantity limitation.
- Partial transfer must divide cumulative sent quantities and frozen inventory effects, preserve legacy consumption-entry origin, and carry already-served kitchen baselines. Calling send/void again would consume/restore stock and generate incorrect new work.
- The INSERT/quantity UPDATE pricing trigger normally reprices at current catalog prices. Exact transfer allocation must preserve the stored price and modifier snapshot.
- A retry after an unknown network outcome needs the same operation ID and expected saved source state; optimistic decrement/removal is unsafe on replay.

## Change ledger
- Quantity input per persisted exact line (four decimal places); refuse unsaved selected-line configurations until saved. Leave all unselected unsaved edits intact.
- Required JSON-payload overload retains the 3-argument client contract. Actor/branch/permission checks, locked source/target, exact expected-row matching, and available unpaid quantity checks precede writes.
- Use existing audit_log UUID primary key as the receipt/idempotency key. Replay verifies actor/branch/source/payload and returns fresh snapshots for the same two orders. No new idempotency table or audit-history scan.
- Split unsent units first. If necessary divide existing kitchen events/effects by subtraction of rounded moved shares, preserving cost/snapshot totals and provenance. Clone no print job, call no send/void/stock writer. Preserve sent actor/time and already-served quantity baselines.
- Add only nullable transfer_origin_event_id, without backfill/index. Legacy unit void/refund lookup uses original event identity. Apply only an exact guarded reference patch to the existing reversal body: retain production’s current legacy implementation, and retain v2 raw snapshot paths during clean canonical replay. No reversal strategy is reactivated or downgraded. Existing six-argument refund overload is unchanged.
- Narrow allocation exceptions in existing ownership/sent/permission/pricing triggers. Existing rules run normally outside the exact actor/order/line/allocation context. Guard captured function sources; the equivalent historical formatting of the catalog pricing trigger is also recognized for clean CI migration replay.
- Lock new quantity transfers per branch using a nonblocking transaction advisory lock; no such lock is added to sale/send/printing. Queries are bounded by affected order IDs and indexed event IDs. Return and patch only the two affected order/table snapshots, suppress stale in-flight branch reads, and make retries use the frozen command.
- Reject partly settled source/destination orders to avoid reallocating discounts against already posted invoices. Fail atomically on historical pre-event order_inventory_consumptions or inconsistent send/served state; never manufacture a plausible inventory history. This is a deliberate limitation for legacy records, not an automatic data repair.

## Verification ledger
Local owned PGlite proof uses captured real transfer, ownership, sent-line, permission, catalog pricing, snapshot capture and void/refund functions. Passed sent 3→2+1, exact IDs with identical target line, original catalog price despite a later change, frozen cost/component/effect conservation, tax/discount totals, idempotent receipt/conflict/stale-source/paid/permission checks, unsent-first movement, preserved served baselines, legacy void/refund origin, atomic legacy rejection, unchanged function metadata and tested disable/replay/full-line-compatibility/resume. No stock/print ledger writes. Twenty-seven focused component/identity/print/snapshot/worklog/error-surface tests passed in 2.46 seconds; application/test typechecks passed. Focused lint passed with three pre-existing hook warnings; build passed in 12.59 seconds. Initial full-schema CI stopped safely at an existing void-reversal source difference before applying this migration. Revised reversal changes patch only the exact lineage reference in either known body, with separate owned proofs for production and canonical variants. Full-schema replay next confirmed the migration and exposed the synchronous header trigger’s ownership context during splitting; establish the existing exact transfer context before the first split write and include the real totals trigger in both owned proofs. The historical October-13 committed rollout suite restores its pinned capture-function fixture only in its freshly created disposable QA database, retaining strict rollout guards without changing any production rollout SQL. Full exact-head CI and final review pending.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration until exact-head mandatory checks pass and the owner approves a concrete release. Migration `20261024170314_partial_item_table_transfer.sql` includes exact source-drift guards and bounded lock/statement timeouts; do not bypass a drift rejection. Run a read-only identity/source/ACL/trigger comparison immediately before any approved apply. Then apply the canonical migration before publishing the matching UI. Verify public asset identity and read-only deployed signatures; no live test order/print.

## Rollback path
1. Apply `scripts/rollback/partial_item_transfer_disable_20261024.sql`: exact source-guarded, atomic, short lock timeout. New JSON quantity requests return PARTIAL_TRANSFER_DISABLED; already committed receipt replay continues to resolve the outcome. Old 3-argument full-line transfers remain usable.
2. Restore the #533 frontend release if needed. Never delete the additive origin column or restore pre-lineage void/refund functions after committed splits: those links are required to reverse existing consumption correctly. No business rows are reversed or rewritten by the rollback.
3. Only after diagnosing and obtaining release authorization, `partial_item_transfer_resume_20261024.sql` accepts the exact disabled body and reenables the verified command. Never retry a failed apply without checking its result and current source.

## Next action
Finish exact-head verification and review. Present release/rollback candidate to owner; do not apply to production automatically.

## Mandatory update protocol
Keep this log/PR synchronized with actual head and gates. Record precise remaining limitations, external check failures, release approval, migration identity and published asset if later authorized. Preserve all prior source hashes and rollback compatibility; historical transfers cannot be undone by restoring old code alone.
