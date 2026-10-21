# Raw transfer safety repairs
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/raw-transfer-safety-20261021`
Current PR: `531`
Last updated: 2026-10-21

## Work status
State: **BLOCKED**
Owner authorizes preparing four verified transfer repairs; final release approval remains separate.

## Guardrails
No production transaction or schema apply during preparation. Do not modify tables, indexes, RLS, privileges, printing, installed Windows agents or actual stock/cost algorithms. Existing security mode retained, never added to bypass RLS. Local Windows pilot excluded.

## Baseline
Main 9bdd4f387d6ddddfed752bb7c2bd759c89007466 (#530 deployed). Read-only production create/approve definitions captured. Isolated original create reproduced differing-unit acceptance and separate headers after repeated calls; normal movement and once-only approval passed existing canonical DB tests.

## Root-cause ledger
Create validates branch identity but not raw unit; approval does not recheck changed units. Form has no synchronous send lock. Awaiting cost response replaces an entire stale lines snapshot. Metadata/cost errors become empty lists/zero.

## Change ledger
Exact normalized-source-hash guarded replacement of create/approve unit checks (live/canonical bodies match after CRLF normalization). Reuse existing source/destination reads for create; approval joins unit definitions in its existing preflight loop, before any stock movement. Legacy both-null units retain their prior behavior. UI locks concurrent submits, blocks ambiguous creation retries within dialog, preserves source audit branch, functional line updates with per-row request tokens, explicit metadata/cost failure states. Source warehouse changes reset lines; quantity edits survive delayed reads. One raw selector remains, matching destination by name/unit. Missing destination still blocks; no automatic raw creation is introduced. Distinct intentional creates remain separate requests; no backend idempotency table/index or new token contract added.

## Verification ledger
16 focused assertions passed. Owned SQL proof checks mismatched creation, matching creation, pending approval rejection, metadata preservation and actual guarded rollback. Initial CI found a formatting-contract mismatch in calculation rounding (corrected without changing values) and an unrelated random four-hex-digit dining-table fixture collision, which aborted three kitchen cases. Fixture names now use the full existing UUID; no timeout increases, removed assertions or production kitchen changes. Transfer regressions passed in that run. Final exact-head CI pending. No production business writes.

## Production gate
State: **BLOCKED**
No Merge ولا Production migration before separate owner approval after final review.

## Next action
Finish exact-head CI and present reviewed repair before deployment.

## Mandatory update protocol
Reconcile main/head before mutation. No ambiguous financial/stock write retry. Verify exact function source and metadata before apply/rollback. Never auto-create a raw material from incomplete metadata.
