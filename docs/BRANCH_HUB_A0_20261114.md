# Branch hub A0 — capability gaps and prototype boundary

Repository: `Premieros/johna-s`; source baseline b5a20662.
This inventory is preparatory. No live database, branch device or credentials
were queried. The operating web app and printing programs are not modified.

## Findings

The source scanner found **234 distinct literal RPC names**, 57 literal SDK
`from()` targets and 558 migration files. Historical SQL includes 1,156 function
CREATE statements and 120 trigger CREATE statements. These are lexical counts,
not counts of installed/active objects. Extensions mentioned in CREATE statements:
pgcrypto, uuid-ossp and pg_cron. Files referencing JSONB (390), numeric (318), row
locks (186), advisory locks (30), auth.uid (345), security-definer functions (391)
and cron scheduling (1) show why a simple SQLite table copy is insufficient.

Reproduce the call-site map and source hashes:
`node branch-hub/tools/audit-source.mjs --out /tmp/johnas-source-inventory.json`.
The dedicated CI workflow retains the full lexical map as an artifact. Review
dynamic SQL, ALTER/DROP patches and overloads before claiming a final dependency
graph or a deployable local database schema.

## Capability/ownership matrix

| Capability | Existing entry points / source | Local-first requirement / current gap |
| --- | --- | --- |
| Orders and floor plan | floorPlan.ts: create_order, create_service_order, update_order, set_order_status | Hub owns transactional order revisions; retain order-type and branch permissions |
| Cash sale | payment.ts: processSaleForOrder; process_sale_idempotent | Atomic local sale + tender + stock/accounting effects + outbox; current offline queue is pending reconciliation, not a complete local ledger |
| Split tender | process_sale_split_idempotent | Current payment.ts explicitly rejects offline split tender; local engine must prove all-or-nothing tender parity |
| Returns / voids | process_refund, cancel_sent_order_item_exact, archive_returned_sale | Retain original paid/sent quantities, financial reversals and explicit permissions; do not invent last-write-wins money |
| Partial transfers | transfer_order_items_to_table, perform_pos_order_action | Stable row identities, quantity conservation and concurrent source/target locks |
| Kitchen send | kitchen.ts / kitchenHandoff.ts, send_to_kitchen and guarded print handoff | Local durable kitchen state and inventory effect with the existing sent/served baseline; do not merely queue a receipt |
| Print work | cloudPrint.ts: enqueue/claim/start/complete_cloud_print_*; kitchenDispatch.ts; installed agents | One local execution owner, durable intents and ambiguous-outcome recovery; cloud import never reprints an already executed local intent |
| Shift / day | open_shift, close_shift_with_open_orders, get_current_business_day | Local branch day ownership, close/reopen races, open-order carryover and cash totals; no competing cloud auto-close writer |
| Inventory / costing | SQL triggers/helpers reached from sale/send/reversal | Canonical published-price policy and negative-stock behavior must match; freeze original financial context/version |
| Configuration | Catalog/prices/recipes/printer routes/central settings | Cloud-owned versions, transactional local activation and preserved historical transaction snapshots |
| Permissions / login | Supabase Auth + SQL permission/branch helpers | Verified offline origin identity and bounded permission lease; no global cloud secret in clients; revocation cannot be instant while disconnected |
| LAN devices | No shared branch server in inspected shell/queue code | One branch API/database behind authenticated LAN clients; no SQL ports exposed; offline assets and trusted transport required |
| App / schema update | electron-builder packaging, remote DEFAULT_URL | Packaging is not an updater: verified release manifest, compatibility gate, backup and safe activation/recovery are missing |

## Existing queues: do not run both as new hub writers

- IndexedDB: OfflineContext and payment.ts enqueue via offlineStorage;
  syncEngine replays/reconciles with ownership/backoff logic.
- localStorage: offlinePosManager is still used for catalog caching in
  PosWorkspacePage and manual queue display/replay in PosTopBar.
- Before cutover, enumerate the actual callers and pending records from each
  enrolled device under an authorized migration flow. Unknown originating-user
  records need explicit reconciliation; never assign them to the current cashier.
- Browser data belongs to the hosted origin. A new localhost/LAN application
  cannot silently read that origin's IndexedDB/localStorage. A deliberate,
  authenticated old-origin export/drain bridge is required if records exist.
- A safe cutover must stop legacy producers/replayers only after their handoff is
  durable and acknowledged. Keep recovery copies; do not empty old queues as a fix.

## Engine decision

Prefer evaluating **PostgreSQL-compatible business execution first**, because
financial operations depend on SQL functions, exact numeric values, JSONB, row
locks and trigger side effects. Existing owned-Postgres CI is useful source
compatibility evidence, but its auth stub is not a branch authentication solution.

This is not a final engine/packaging approval. SQLite may be useful for auxiliary
storage, but is not accepted as a replacement for these financial functions until
sale/split/return/kitchen parity is executable. Native PostgreSQL, embedded
PostgreSQL and a packaged Linux runtime each need Windows/extension/resource and
service-lifecycle evidence. Do not assume the existing personal-PC Docker stack
fits branch hardware, or that a bundled SQL server automatically supplies Auth,
Realtime, storage and local authorization.

The final A0 gate remains OPEN: obtain real branch hardware reports, inventory
transitive SQL dependencies, and run representative canonical sale, reversal and
kitchen/print fixtures under the candidate runtime. No business engine is chosen
or replaced in this change.

## Executable boundary delivered now

1. Read-only Windows hardware diagnostic (no hardcoded free-space requirement,
   no credentials, no production/network probes or installs). The report explicitly
   says readiness has not been assessed. PowerShell fixture mocks hardware.
2. Reproducible source inventory, with lexical/static limitations recorded above.
3. Unwired operation-envelope prototype: immutable decimal-string payload,
   stable origin/ID/time/sequence/version, deterministic digest, duplicate-vs-
   conflicting-ID classification and branch/device/user scope validation.

The digest is not an authentication signature. Context must later be derived from
verified enrollment plus attested originating-user authorization, not request JSON.
This prototype has **no durable inbox/outbox, business handler, HTTP listener,
cloud connection or print executor**. It does not claim successful synchronization
or complete exactly-once business effects, much less exactly-once physical printing.

## Next executable milestone

Build an owned local runtime fixture around the canonical financial operations;
compare sale, split tender, reversal, kitchen delta and print-intent identity before
selecting the production hub engine. In parallel collect branch diagnostic reports.
Only then implement the shared local API and atomic operation/outbox persistence.

## Disposable embedded PostgreSQL schema probe — 2026-11-14

`branch-hub/experiments/probe-pglite-schema.mjs` replayed all **558** canonical
migration files successfully on externally installed **PGlite 0.5.16**, using a
fresh in-memory database, canonical CI Auth stub and migration tracking table.
No production credentials, data, connection string or network database were used.
The script reports its package version and a digest of sorted migration names
and contents, so future results can be compared with the exact source inputs.

Observed migration-source SHA256:
`b0411ac0648f4914a3b2bcf23a15bd862b0204bf2b260f453ee57833eea128ee`.
Installed extensions: `pgcrypto` 1.4, `plpgsql` 1.0, `uuid-ossp` 1.1.
**pg_cron was not installed**: conditional migration success must not be mistaken
for a running scheduler or extension parity. Scheduler ownership remains a gap.

This is DDL compatibility evidence only. It does not exercise sale/split/refund/
kitchen semantics, physical printing, native concurrent clients, filesystem
durability, offline authorization, Windows packaging or upgrades. The harness
does not reproduce the CI migration applier's outer transaction wrapping.
No embedded engine is approved for branch deployment by this result.

At prior PR head `c6098838aebb799aaa804a56ca4f893fa90a592b`, both full Verify main
and isolated Branch Hub A0 workflows passed, including Windows PowerShell 5.1
diagnostic fixtures. New probe changes require their own PR checks.

## Synthetic recovery trial package

The optional `--financial-boundary` mode now executes the canonical
`reconcile_offline_sale` function against fictional branches, cashier and a
previously committed sale. Seven checks passed locally: exact acknowledgement,
lost-ACK retry identity, amount/tender conflicts, branch rejection, rejection of
ordinary invoice numbers, unchanged single settlement, and anonymous denial.
The fixture is rolled back. This is not creation of a new offline sale and does
not close the sale/split/refund/kitchen parity gate.

`branch-hub/lab/Run-Synthetic-Lab.cmd` prepares a locked PGlite dependency in a
separate cache using a disposable Node container, then runs the synthetic probe
in another container with networking disabled, read-only source/dependencies,
no published ports, no Docker socket and no production credentials. It does
not use `docker exec`, compose, existing containers or database volumes.
The only host writes are its package cache and JSON report. Test containers
are limited to 2 GiB / 2 CPUs. Initial preparation needs Internet; resource use
on the test computer is not zero. Use a non-cashier lab computer.

A PowerShell mock verifies launcher arguments and error propagation. Actual
network-disabled Linux container execution is covered by the dedicated CI job;
The owner subsequently completed the seven-check trial successfully on Windows Docker Desktop. This package
has no POS interface and must not be described as a complete application trial.

## Canonical business fixture evidence (A0, owned memory database)

A dedicated experimental Vitest configuration now substitutes **only** the test
connection helper with an in-memory PGlite adapter. The selected canonical TS
fixtures, their SQL calls, assertions and production migrations are unchanged:

- `split_payment_atomicity`: 3 cases; cash/card tenders, no double inventory
  deduction after kitchen send, tender mismatch creates no sale.
- `kitchen_quantity_delta`: 4 cases; stable-line increments, exact void/net delta,
  deletion guard while effects remain, new delta on served-order reopen.
- `process_sale_order_settlement`: 5 cases; header discount, held takeaway payment,
  second-payment rejection, foreign-branch rejection, freeing the settled table.
- `auto_sale_production_reversal`: 4 cases; raw-source restoration, existing unit
  stock restoration, kitchen reversal and nested component reversal.
- `modifier_burger_lifecycle`: 1 transactional lifecycle with exact modifier
  consumption, settlement and exact-line refund.

**17/17 passed locally**, no skipped cases. CI validates the JSON report against
all seventeen cases, so optional impersonation skips cannot count as success.
Native `pg.Client` is explicitly blocked in this configuration. No `.env` or
real database URL is read by the substitute helper. The adapter rejects multiple
simultaneous clients rather than simulating cross-session transactions.

The fixture uses the existing CI-only Auth stub, subscription-bypass and role
fixtures. This tests business SQL behavior under synthetic identity, not real
Auth login, offline authorization, a valid paid subscription or branch identity
attestation. Only a fresh memory database receives those CI fixtures. It does
not install subscription bypasses into the user's existing local Supabase.

Multi-client races, durable commits and reopen/recovery, shared LAN service,
physical printing and UI remain unproven. Native PostgreSQL CI remains the
reference implementation. These results do not authorize a production cutover
or choose the final Windows engine.

Run from a source checkout with root development dependencies installed:
`JOHNAS_TEST_PGLITE_PACKAGE_ROOT=/path/to/pglite npx --no-install vitest run -c branch-hub/experiments/vitest.canonical.config.mjs`.
The user-facing synthetic ZIP still executes only the earlier seven recovery
checks; it is not a bundle of this Vitest development fixture or a POS UI.

## Personal-PC automatic browser update experiment

The owner requested an immediate automatic update experience and a personal-PC
trial. `branch-hub/update-lab` now supplies a standalone Arabic browser lab on
loopback port 58110. It is not wired into the original app or agents. A local
synthetic publisher models reconnection and releases; no GitHub/cloud URL or
credential is accepted. The feed port stays internal to the disposable Docker
container. The launcher does not touch existing Supabase services or databases.

The lab checks Ed25519 signatures, exact payload hashes/sizes, increasing release
sequence and schema compatibility. Compatible presentation data activates without
page reload while the textarea stays mounted. Activation waits for an explicitly
tracked fake payment. Corrupt packages keep the old active version. Draft edits
and presentation state are serialized to atomically replaced files; a normal
stop/restart test preserves them, with a browser localStorage recovery copy.

This is a DATA-only presentation release: **it does not install downloaded
JavaScript, production assets, SQL migrations or a real POS screen**. Signing keys
are lab keys generated locally, not a production trust root. The fake payment is
not a sale, and its busy flag is not a durable business/outbox barrier. Sudden
power-loss, process-crash recovery, real Auth, shared LAN clients, safe full-code
activation, signed production distribution and automatic schema upgrades remain
unimplemented. Native schema incompatibility is rejected, never auto-migrated.

Local Node checks passed for signature/tamper/rollback/schema gates and the API
outage/reconnect/payment/draft/normal-restart flow. PowerShell launcher argument
fixture passed locally. Local Chromium could not start because this execution
environment disallows its singleton socket, so real browser and Docker verification
are delegated to a dedicated CI job; Windows PowerShell 5.1 launcher checks run
there too. The browser trial artifact is emitted after its browser/Docker checks.

CI browser verification passed: automatic activation, preserved textarea, offline
feed/reconnection, corrupt-package rejection and payment barrier, with exactly one
initial page navigation. The Docker smoke initially received a connection reset. Retained startup logs
then identified EACCES writing the lab-only key file: the host runner owns the
state bind directory, while the root container has all capability overrides
removed. The Linux CI smoke now runs as the host directory owner UID/GID,
without making the directory world-writable or restoring broad capabilities.
The readiness probe retries startup errors and retains logs before cleanup;
actual container readiness/update must pass before the artifact is emitted.
Windows Docker Desktop bind permission behavior still requires the user trial.
