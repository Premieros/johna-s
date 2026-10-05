# POS ERROR DIAGNOSTICS — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/pos-error-diagnostics-20261005`
Current PR: `#452`
Last updated: 2026-10-05

## Work status
State: **BLOCKED**
Isolated frontend diagnostic patch under verification. Not deployed.

## Guardrails
Preserve permission-first authorization, branch isolation, financial visibility and operational truth.
No database migration, policy or function change and no real sale, kitchen send, data edit or test printing.
Payment payloads, idempotency, offline behavior, financial calculations and Print Agent remain unchanged.
No merge before exact-head Full Verify Green and explicit approval.

## Baseline
main 7ad2b318ab5dde120e9f125b249afd5f8b6fc04c, #451 merged/deployed.
#451 post-merge Full Verify 37297455824 succeeded.
#450 Production guard patch applied after separate explicit approval; no further DB apply in this patch.

## Root-cause ledger
Historical sosy CLIENT_ERROR events retain only the generic message, screen and toast_error action.
Their exact original failure is unrecoverable from the existing event fields; warehouse causality remains unproven.
Payment error flattening drops Supabase codes and JavaScript error types.
Identifier extraction discarded numeric SQLSTATE and PGRST codes and missed business codes after ordinary words.
New Production reads show three stale_chunk_error events on kitchen-display, shifts and dashboard.
Dynamic-import failure was classified as NETWORK_ERROR because generic fetch matching preceded chunk matching.
Deployment currently uploads only the new dist; previous asset retention needs separate operational review.

## Change ledger
Keep original failure in memory as optional diagnostic on rejected payments; success and write contracts unchanged.
Toast keeps its visible message and optionally passes source/context to classification; source is excluded from RPC options.
Capture PGRST codes, SQLSTATE identifiers, standard JavaScript names and existing business rejection codes.
Prioritize dynamic-import/chunk failures over generic network text; do not change automatic reload behavior.
Add settlement submission/read action, branch and order identifiers through existing bounded telemetry RPC.
Never send raw error objects, request payloads, details or stacks to telemetry.

## Verification ledger
Focused behavioral tests cover payment single-attempt rejection, no ambiguous offline enqueue, split rejection,
original toast source with unchanged visible message, safe telemetry payload and telemetry failure isolation.
Final unit/component suite: 293 files / 1434 tests passed before the additional chunk classification regression; focused final tests passed.
Typecheck:all, production build and changed-file lint passed; zero lint errors, two pre-existing hook warnings.
Exact-head remote CI pending.

## Production gate
State: **BLOCKED**
Frontend review only; no Production database apply included.

## Next action
Complete final unit/component and exact-head Full Verify checks; request approval for the concrete reviewed frontend patch.
Do not mark historical sosy errors resolved or infer absence of new telemetry proves all live workflows healthy.

## Mandatory update protocol
Single writer; reconcile main and remote branch before writes. No direct main write or force push.
