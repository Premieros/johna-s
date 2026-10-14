# Database read recovery — 2026-10-14
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/database-read-recovery-20261014`
Current PR: #501
Last updated: 2026-10-14 owner-directed frontend read reduction

## Work status
Owner requests lower database consumption and then "اريد التعديل بدون التاثير علي النظام". Implement two frontend display-read reductions on the same #501 branch. No production SQL/index activation, merge or publication is authorized by this implementation request. Six-index package stays HELD after ~47% purchase WAL amplification.

## Guardrails
One active development branch, this repository/database only. No production test orders, prints, requeues, agent changes, historical repricing, FIFO/settlement rewrite, grants/RLS/functions/triggers changes or security bypass. Never catch QUERY_CANCELED to make a timed-out operation look successful. The rolled-back kitchen optimization stays disabled.

## Baseline
main `7ee483788037dfc0c50a759f4fbef9d2f35e5789`; #500 deployed and postmerge 1741 frontend/1044 DB/132 browser tests Green. Earlier print/FIFO index scripts are historical proposals, not activated.

## Root-cause ledger
24h error review ends2026-10-14T06:33Z: most recent PostgreSQL timeout remains2026-10-13T19:14:32Z. Kitchen approved-price capture at19:13:21Z and settlement at19:13:52Z also timed out. This is not proof of a new incident after #500 or a count of unique failed orders.
Canonical settlement joins already have order/item/event indexes. No reproduced evidence justifies changing payment arithmetic or authorization. Permission-denied events occur after missing auth sessions; do not widen grants. audit_log RLS errors and invalid realtime filter are separate open investigations.
The capture trigger's OTHERS handler deliberately excludes query cancellation; masking that exception would also mask operator cancellations. No change is prepared to this handler.
Representative existing last-known-cost read on one material with3023ledger rows used3279buffers/251.973ms; privileged approved-price read of two materials used2492buffers/137.371ms. Single warm read-only samples, not authenticated production p95. Existing print baseline from #500 scanned7182rows/6099buffers. No production data was changed.

## Frontend read reduction — authorized2026-10-14
ApprovalInbox has independent approval/print-alert read queues. Normal first-attempt print events do not read either queue; failures/recovery/previously visible/unknown events reconcile alerts only. Approval events and decisions reconcile approvals only. Reads pause while hidden, resume on visibility and reconcile on reconnect. Errors retain existing alerts; scope changes cancel pending results.
Printer monitor keeps visible5s cadence, uses one active read/one trailing refresh, pauses hidden reads and clears/discards prior branch/account responses. Display-only projection selects status fields and payload->>text needed for existing order/table labels, excluding HTML/templates/other print execution payload. No new request, cross-user label cache, schema, DB write or agent protocol. Prior rows remain visible with a read error.
Actual latest150-row readonly JSON sample: full list326198bytes versus display projection144395bytes (~56% smaller). This measures JSON representation of one sample, not overall database CPU or billed egress. Tests must prove100normal print events generate0notification rereads, failures/recovery survive, monitor labels/cadence/scopes/errors and hidden-page behavior. Exact-head full CI remains required before merge.

## Change ledger
A six-index review manifest reuses the existing print-prefix, recent relevant-alert, last-known FIFO issue/receipt/batch proposals, and adds a partial approved-purchase lookup. No competing stock/price source, function rewrite or canonical migration.
`read-index-review.mjs --plan` prints concurrent DDL without connecting. `--apply` requires a dedicated verified-TLS direct/session-mode connection, exact johnas host/project/database identity, separate owner SQL approval acknowledgement, and absent index names. This acknowledgement is not user approval by itself. Each CREATE INDEX CONCURRENTLY runs outside transactions, one at a time, with2s lock/60s statement bounds. Existing/invalid names fail before DDL; cancellation stops rather than retries. Successful-prefix/invalid-index state must be reviewed after a partial build; no automatic drop, writer termination or repair.
Catalog digests compare function definitions/owners/ACLs, policies, trigger flags/definitions, constraints and table RLS/ACLs. This does not make the concurrent build atomic and cannot promise zero resource overhead. No index INCLUDE of a wide reference-number text column.
Target validation tests reject foreign projects, other databases, transaction pooler, unverified TLS, unapproved production and shared localhost databases. Native concurrency proof uses a newly owned/disposed CI database; canonical fixture parity checks prices/as-of/RLS/frozen snapshots and FIFO cost.

## Verification ledger
Local target guard3tests, typecheck/lint and all1744unit tests passed at `dde303cb`. Its native Fast CI passed17price/concurrency tests: read buffers1482→16; 64-row purchase WAL median45570→66514bytes (~46% higher), execution median0.887→1.052ms. Synthetic warm samples, not production p95 or net-load proof. Concurrent enqueue/update succeeded while the index build waited for a writer; price/as-of/branch-denial/frozen snapshot/FIFO parity remained unchanged. A full canonical20-line negative-stock send/payment diagnostic is added next; final exact-head full CI remains required. Do not recommend all six indexes solely from read gains.

## Production gate
State: **BLOCKED**
No database connection secret is available in this execution environment. The Supabase connector can still do read-only inspection; its suitability for top-level concurrent DDL is not assumed. No production CREATE/DROP attempt is used to test that capability. Production activation needs final explicit approval, a suitable dedicated verified connection, exact manifest/head reconciliation and resource assessment.

## Next action
Run exact-head Full CI for the frontend changes, including native business and browser regressions. Record final validation in #501 metadata and seek separate frontend merge/publication approval. Six-index package is not recommended for activation; no production DB change.

## Mandatory update protocol
Fetch branch/main before GitHub mutation; stop/reconcile on drift. No direct main write/force push. Record final exact-head validation and approvals in PR metadata without adding untested code commits.
