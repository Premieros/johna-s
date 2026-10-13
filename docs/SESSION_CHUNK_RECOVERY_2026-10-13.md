# Session and screen recovery — 2026-10-13
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/session-chunk-recovery-20261013`
Current PR: #0
Last updated: 2026-10-13 owner-directed preparation

## Work status
Frontend-only preparation authorized by "كمل" after read-only operational review. Not authorized for new production deployment yet.

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
Production build and changed-file lint passed. Typecheck and targeted/full frontend tests running; final counts recorded in PR metadata. React review: lazy components remain module-scoped, import paths static, retry bounded, no new subscriptions or authorization grants.

## Production gate
State: **BLOCKED**
Requires exact-head Full Verify Green and explicit owner publication approval. No migration.

## Next action
Complete tests; publish draft and exact-head CI. Report reviewable result before merge.

## Mandatory update protocol
Fetch fresh exact branch head before each GitHub mutation. Stop on drift. Keep this log/plan current; record final verification and approvals in PR metadata without claiming operational success before publication.
