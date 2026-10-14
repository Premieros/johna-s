# Kitchen print handoff emergency — staging only
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/kitchen-atomic-print-handoff-20261014`
Current PR: #505
Last updated: 2026-10-14 Cairo

## Work status
State: **BLOCKED**. Isolated experimental server-side atomic print handoff, not deployed.

## Guardrails
No production SQL, sales/stock changes, installed Windows agent changes, automatic reprints, or live test orders. No unsupported performance claim. Preserve idempotent cloud print jobs and branch authorization.

## Baseline
main 8fffc3d3. PR #504 browser polling change was closed without merge. The two earlier missing kitchen cloud tickets were not replayed.

## Root-cause ledger
The authoritative kitchen send commits before the browser independently calls enqueue_cloud_kitchen_print. A closed browser or failed handoff can leave a sent order without a cloud ticket. The installed V8 agents are not being changed.

## Change ledger
A proposal outside the migrations directory adds a private helper that creates a kitchen print job from the exact send delta in the same transaction. The job identity matches the browser station and sorted send-id/cumulative-quantity key. Existing frontend retry then resolves the same job. This candidate must not run on production before full tests and review.

## Verification ledger
Staged rollback-only database integration tests for idempotency, station payload, branch rejection, wrapper signature and no-delta retry. Execution and thermal layout parity remain pending.

## Production gate
State: **BLOCKED**. No automatic migration or production approval. Must verify FIFO/void, failed enqueue rollback, thermal template equivalence, client coexistence and load safety before any release.

## Next action
Run one exact-head mandatory CI check after review, avoid needless retries. Report failures rather than bypass checks.

## Mandatory update protocol
Single writer, no direct main edit or forced push. Never reprint previously submitted or ambiguous jobs. Protect original orders and financial records.
