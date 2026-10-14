# Kitchen print handoff emergency — staging only
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/kitchen-atomic-print-handoff-20261014`
Current PR: #506
Last updated: 2026-10-14 Cairo

## Work status
State: **BLOCKED**. Optional non-disruptive server-side print handoff experiment, not deployed.

## Guardrails
No production SQL, sales/stock changes, installed Windows agent changes, automatic reprints, or live test orders. No unsupported performance claim. Preserve idempotent cloud print jobs and branch authorization.

## Baseline
main 8fffc3d3. PR #504 browser polling change was closed without merge. The two earlier missing kitchen cloud tickets were not replayed.

## Root-cause ledger
The authoritative kitchen send commits before the browser independently calls enqueue_cloud_kitchen_print. A closed browser or failed handoff can leave a sent order without a cloud ticket. The installed V8 agents are not being changed.

## Change ledger
The proposal is outside the migrations directory and leaves the existing public.send_to_kitchen(uuid,uuid) UNCHANGED. It adds an opt-in public.send_to_kitchen_with_print(uuid,uuid,boolean) RPC. That RPC calls the canonical send first, then best-effort enqueues a matching Arabic kitchen ticket from the authoritative delta, using the existing client identity. Any queue failure returns print_queue_state=client_fallback instead of blocking a kitchen send. No-delta returns not_needed. English UI returns client_only and uses the existing client formatter (no incorrect Arabic paper). The current POS frontend is NOT switched to the opt-in RPC; this requires separate tested enablement.

## Verification ledger
Staged rollback-only database integration tests for idempotency, station payload, branch rejection, wrapper signature and no-delta retry. Execution and thermal layout parity remain pending.

## Production gate
State: **BLOCKED**. No automatic migration or production approval. Must prove canonical send is unchanged, failure fallback preserves stock/send, actual client opt-in with locale, FIFO/void/incremental sends, existing thermal format, permissions and bounded latency before controlled release. There is no production-facing improvement until rollout is explicitly enabled.

## Next action
Run one exact-head mandatory CI check after review, avoid needless retries. Report failures rather than bypass checks.

## Mandatory update protocol
Single writer, no direct main edit or forced push. Never reprint previously submitted or ambiguous jobs. Protect original orders and financial records.
