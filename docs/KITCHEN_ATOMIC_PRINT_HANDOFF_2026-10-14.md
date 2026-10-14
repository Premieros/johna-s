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
The proposal is outside the migrations directory and leaves the existing public.send_to_kitchen(uuid,uuid) UNCHANGED. It adds an opt-in public.send_to_kitchen_with_print(uuid,uuid,boolean) RPC. That RPC calls the canonical send first, then best-effort enqueues a matching Arabic kitchen ticket from the authoritative delta, using the existing client identity. Any queue failure returns print_queue_state=client_fallback instead of blocking a kitchen send. No-delta returns not_needed. English UI returns client_only and uses the existing client formatter (no incorrect Arabic paper). The POS hook is now wired through a build-time feature flag `VITE_KITCHEN_ATOMIC_PRINT_HANDOFF`, default OFF. With flag off it calls the legacy service, unchanged. When enabled *after* a separate reviewed deployment of the new SQL RPC, the UI sends its real `isAr` locale. A confirmed `queued` response marks stations queued and returns `suppress_kitchen_browser_popup=true`, and the POS hook explicitly skips automatic browser printing WITHOUT re-enqueue, local paper or hijacking the global `window.open`. Any unrecognized or contradictory server print acknowledgement likewise suppresses a second ticket and warns instead of guessing. `client_fallback` and `client_only` use the original station dispatcher. An unrecognized/ambiguous queue state does not print again. Only a confirmed missing RPC error (`PGRST202`/`42883`) calls the legacy send; timeouts never trigger duplicate send attempts.

## Verification ledger
Isolated PostgreSQL integration: original RPC invariance, branch/auth, real incremental delta key, no-duplicate, locale, and simulated queue failure; previously green at #38632216031. Added isolated unit tests for feature flag default off, confirmed queue suppression, fallback, English, malformed and unknown acknowledgements, missing RPC and timeout. The web print skip is explicit in the POS hook rather than relying on a temporary `window.open` interception. All four jobs passed on earlier opt-in branch at #38636675702. Branch-scoped gate commit 25928a89: DB/browser/pages green, 11 handoff behavior tests green; full Verify job failed solely due to the now-stale string in the static dispatch contract. This revision updates that exact assertion and needs one exact-head CI recheck. Physical paper and production load/stock contention remain unproven.

### Measured production risk — 2026-10-14 UTC ~21:10
READ ONLY Supabase logs (trailing 24h): 42 Postgres statement cancellations/timeout messages across DB traffic; kitchen RPC response origin p95 ~2,928 ms, max ~41,846 ms (268 calls); client kitchen enqueue origin p95 ~765 ms, max ~9,723 ms (261 calls). These are **separate** timings and must not be naively added as a guaranteed server-side measurement. They show a material tail-latency risk if synchronous server queue work is added after the existing kitchen send: `EXCEPTION WHEN OTHERS` does not protect the overall transaction from external Postgres statement cancellation. No production latency safety claim from isolated DB tests.
**Gate:** no all-branch global enablement. Even a build with `VITE_KITCHEN_ATOMIC_PRINT_HANDOFF=true` does NOT opt in unless `VITE_KITCHEN_ATOMIC_PRINT_BRANCH_IDS` explicitly contains that saved POS branch ID. Start with a single approved pilot branch after new SQL has been installed separately; with either env unset the old route remains active. Roll back by removing pilot branch from the configured allowlist and deploying that client configuration (the legacy public.send_to_kitchen remains unchanged). Live production SQL and stock remain untouched during this staging.
Before pilot require measured isolated end-to-end response latency, supported operational window, exact branch + locale verification and explicit approval; never claim this flag can be toggled remotely without rebuilding.

## Production gate
State: **BLOCKED**.
Merge requires owner approval AFTER all CI succeeds. Merging a build with both feature flags unset does not enable new print routing; actual DB SQL activation requires a SEPARATE, explicitly approved production action. Verify that production build environment does not set VITE_KITCHEN_ATOMIC_PRINT_HANDOFF or a pilot branch ID. Never combine merge approval with database rollout approval.
Before live activation: conduct non-production latency/lock-contention tests representative of current p95 and timeout conditions; validate served/void/FIFO and exact branch print path; prepare stop procedure and monitoring without reprinting unknown-status jobs. No guarantee of physical paper solely from submitted cloud job state. No automatic migration or production approval. Must prove canonical send is unchanged, failure fallback preserves stock/send, actual client opt-in with locale, FIFO/void/incremental sends, existing thermal format, permissions and bounded latency before controlled release. There is no production-facing improvement until rollout is explicitly enabled.

## Next action
Run exact-head mandatory CI once for the combined web-only integration patch. Leave production flag OFF and do not ship the candidate SQL until an explicit separate performance and operational rollout gate passes.

## Mandatory update protocol
Single writer, no direct main edit or forced push. Never reprint previously submitted or ambiguous jobs. Protect original orders and financial records.
