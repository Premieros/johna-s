# Session and screen recovery — 2026-10-13
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/session-chunk-recovery-20261013`
Current PR: #500
Last updated: 2026-10-14 owner-directed repair preparation

## Work status
Owner requests actual repairs on2026-10-14. Continue the existing single #500 branch. Frontend repairs and isolated index review are authorized; production publication/DDL still require explicit approval.

## Guardrails
Single writer, this repository/database only. No production SQL, auth settings, agent installation, printing replay, test orders, inventory/accounting changes or security bypass. Explicit global logout and inactive-profile revocation stay unchanged.

## Baseline
main46f1277b543da6b8f223e8d87be28c95357888b8 (#499 published). Print source-branch guard already applied20261013144819. Previous optimization remains disabled.

## Root-cause ledger
Observed21:12Cairo CHUNK_LOAD_ERROR for ali-elsayed on Cleopatra POS. Telemetry lacks asset URL/status; exact network-versus-missing-file cause unknown. Latest auth failures report refresh_token_not_found and session_not_found. Their original revocation cause is unknown; no claim that this patch reconstructs missing tokens.
Confirmed code risk: automatic expired-session cleanup called default-global Supabase signOut, potentially revoking other sessions of the same account. Official auth-signout documentation confirms scope semantics.

## Change ledger
Expired-session cleanup now uses local scope; explicit logout and missing/inactive profile retain prior global behavior. Layout buttons explicitly call signOut without passing a mouse event. Profile guard expiry uses local scope.
Lazy route loaders retry one recognized module-load failure after250ms; non-module exceptions fail immediately; use no new connectivity source. No page reload or POS mutation is replayed by this helper. Existing one-reload boundary cap retained. Error copy no longer asserts a new deployment as the only cause.

## Verification ledger
Production build and changed-file lint passed. Typecheck:all and25 targeted tests passed; full frontend suite355 files/1721 tests passed. Exact-head CI pending; final results recorded in PR metadata. React review: lazy components remain module-scoped, import paths static, retry bounded, no new subscriptions or authorization grants.

## Production gate
State: **BLOCKED**
Requires exact-head Full Verify Green and explicit owner publication approval. No migration. The new index proposal is outside canonical migrations and is never applied by deploy workflows.

## Next action
Complete exact-head CI after runtime/session/notification changes and isolated print-index tests. Report a concrete frontend/index package before any merge or production DDL. Preserve the original chunk-causality HOLD; asset failure URL/status remains unknown.

## Mandatory update protocol
Fetch fresh exact branch head before each GitHub mutation. Stop on drift. Keep this log/plan current; record final verification and approvals in PR metadata without claiming operational success before publication.

## Read-only investigation — 2026-10-14
24h window2026-10-13T05:45Z–2026-10-14T05:45Z:44 PostgreSQL57014 events.13 notification print reads,9 open-check lock reads; the rest include dashboard/income, kitchen pricing/FIFO, payment settlement, cancellation/order/profile/shift/realtime. These are database failures, not44 unique orders. Last failure19:14:32Z on print notification SELECT.19:13:21Z price capture during send and19:13:52Z payment settlement prove operations were also affected; the index/notification patch cannot claim to resolve every path.
Global logout requests are confirmed by edge URLs /auth/v1/logout?scope=global around19:13:13–19:13:20Z. Auth logs show repeated logout for the same actor followed by session_not_found. Initiating UI/automatic call site and every28 missing-token incident remain unproven. Do not misclassify routine token_refreshed+token_revoked rotation as malicious revocation.
Read-only print SELECT on Cleopatra without caller RLS:40 rows,221 in range; existing index scans/filter removes6961 old rows,6099 shared buffers,247.371ms on one sample. Existing receipt prefix guard:7182 removed rows,6099 buffers,30.857ms. These are one warm production snapshot, not p95 nor RLS-equivalent benchmark.

## Runtime repair extension — 2026-10-14
Shared refresh result classification preserves the session on503/429/network/statement failures; definitive revoked/invalid sessions still clear locally. Successful refresh followed by a transient profile read returns verification unavailable, not sign-out. Inactive/missing profiles retain global revocation. Cold hydration is versioned so pending initial/profile reads cannot restore a signed-out user; verified identity is not read again on the effect rerender.
ApprovalInbox applies the failure/recovery predicate before the server limit, coalesces realtime bursts into one active/one trailing read, discards obsolete branch/user results, and retains current alerts when a read fails. No print job writes or execution/routing changes. StrictMode cleanup creates a fresh refresh queue.
SessionProfileGuard retries unavailable refresh, ignores stale refresh/cache completions, catches transport rejection, and resets verification on effect cleanup for StrictMode.
New scripts/experiments/runtime_print_read_indexes_candidate_20261014.sql contains only two review indexes:receipt prefix text_pattern_ops and recent relevant-alert rows. No production apply, function/RLS/constraint change or FIFO/accounting rewrite. Local embedded PostgreSQL plan rehearsal and native canonical DB/RLS tests are distinct evidence; the latter must pass in CI.

## Verification progress — 2026-10-14
First local full frontend run357files/1735tests passed before the final inbox filter/guard additions.19 targeted behavioral tests passed before the final filter adjustment; typecheck/build passed at that point. Final exact-head local checks and native DB/browser CI pending. React review covers cancellation, effect scope/StrictMode, bounded reads and unchanged authorization/operational mutation flows.

Final local checks:358files/1738frontend tests passed after all runtime/filter/guard code edits; then22targeted tests passed including three added background-guard behaviors. Typecheck:all, production build, changed-file lint, API166RPC/56table contract, locked identity and whitespace checks passed. Embedded PostgreSQL17 rehearsal with14060synthetic print rows preserved exact alert rows; relevant-alert read256buffers→3buffers,3.522→0.151ms in that single local sample. Receipt prefix used an already-efficient C-collation baseline, so no production speedup claim is drawn from it. Native canonical/RLS fixture tests and browser CI still required. No production change.
