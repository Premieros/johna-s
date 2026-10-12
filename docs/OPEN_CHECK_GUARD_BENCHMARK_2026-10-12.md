# Open-check print guard investigation — 2026-10-12

Issue: #489. This is a **non-production experiment**, not a deployed fix.

## Verified read-only baseline

The current `get_open_order_print_state` query checks branch ID, receipt kind,
and an `open-check:<order-id>:%` idempotency-key prefix. A sample production
EXPLAIN selected the existing claim index by branch ID and then filtered
about 6,100 other rows. Two individual executions took 20.216 ms (absent)
and 7.081 ms (present), with more than 5,500 shared buffer hits each.
These are single samples, not representative p95 or proof of root cause.

The October 11 timeout cluster affected printing and kitchen endpoints
and other operations; system-wide load may also matter.

## Experiment

`scripts/experiments/open_check_guard_isolated_benchmark_20261012.sql`
builds synthetic temporary queue data, checks existing/missing receipts in
two branches, and compares four read-only EXPLAIN plans before and after a
temporary partial prefix index. It asserts semantic parity and rolls back.

The actual schema index remains a **proposal only** in
`scripts/experiments/kitchen_fifo_print_indexes_candidate_20261011.sql`.
No canonical migration, print logic, FIFO, or accounting is modified.

## Acceptance gate

Run the experiment on an independent local/staging Postgres instance;
compare plan, buffer use, index overhead, and repeated timings. Confirm
deduplication, cross-branch denial, kitchen isolation, and manager reprint
behavior. An empty development database is not production-equivalent.

Obtain separate approval before any billable staging environment or
production DDL. Production deployment needs its own lock strategy,
independent approval, rollback instructions, and exact-head green CI.
Older candidate `SET LOCAL` statements must not be treated as a safe
production migration script.

Outstanding work: independently investigate #486 scoped ingredient price
lookups and #489 negative-stock FIFO paths. Do not modify historical costs,
print queue state, warehouse pins, or accounting entries.
