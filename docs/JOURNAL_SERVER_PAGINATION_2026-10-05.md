# JOURNAL SERVER PAGINATION — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/journal-server-pagination-20261005`
Current PR: `#0`
Last updated: 2026-10-05
Execution mode: **SINGLE_WRITER**

## Work status
State: **BLOCKED**
Additive database read proposal only. No Production apply or frontend activation.
Exact-head verification and separate explicit Production approval are pending.

## Guardrails
No Production business-data writes, test transactions or real printing. No role-name
authorization. Preserve caller RLS, restrictive Financial Visibility, history clamps,
legacy API and every posting/settlement/Print Agent contract. New function apply requires
specific explicit approval. Isolated fixtures run only against the CI auth stub and roll back.

## Baseline
Main e47108f32fd0cd8a928447c55f470dbbe2db64c0. #449 deployed; post-merge Full Verify
37306845880 succeeded. Read-only Production catalog confirms legacy get_journals is a
stable invoker API and builds every matching entry's nested lines. Existing indexes
cover journal branch/date and line entry ID. No index or policy change is proposed.

## Root-cause ledger
Client table paging bounds rendering, but get_journals still constructs/transmits all
nested journal lines for the full authorized range. This proposal bounds nested payload;
complete totals still require reading/aggregating all matching visible lines. No claim
of constant database cost or Production speed improvement before measurement.

## Change ledger
Add get_journals_page only, with default 100 / maximum 200 entries. Stable keyset order:
entry_date, entry_number, id. Cursor fields are all present or all absent. Summary count,
debit, credit and balance cover the complete filter, independent of cursor, preserving
legacy per-entry rounding. Nested account detail is built only for the bounded page.
All reads are SECURITY INVOKER; authenticated/service_role grants match the legacy API;
PUBLIC/anon execution is revoked. No schema/table/index/policy or existing function edits.

## Verification ledger
Seven new actual PostgreSQL tests cover full totals, exact legacy parity across 205 entries,
no duplicate/missing pages, cross-branch rows/summary, invalid bounds/cursors, history/filter
semantics, restrictive linked-sale visibility and function security. Local database tests
are not counted as passed when no database is configured. Full isolated CI is required.
Local checks and exact-head CI pending.

## Production gate
State: **BLOCKED**
Do not apply migration 20261005122723_journal_page_read.sql without separate explicit approval.
No frontend references the new RPC, so creating the function alone cannot switch a live
screen. Proposed apply: additive function/grants/comment only, 2s lock timeout and 10s
statement timeout. Catalog verification must confirm legacy function, grants/policies and
posting functions unchanged. Do not run integration fixtures or full-range benchmarks on
Production. No rollback is automatic: an unused additive function may remain safely;
dropping it needs separate approval and a dependency check.

## Next action
Complete isolated exact-head CI and present the concrete database-only proposal. After
explicit approval and verified apply, prepare frontend cursor paging as a separate PR.
Keep global totals visible; reset cursors on branch/user/filter changes, reject superseded
reads, preserve manual posting and printing/export behavior.

## Mandatory update protocol
Single writer. Verify current main/head before every remote mutation; unexpected movement
means STOP_AND_RECONCILE. Bind the actual PR number and all evidence before approval.
Update review completion in PR metadata without invalidating the tested code head.
