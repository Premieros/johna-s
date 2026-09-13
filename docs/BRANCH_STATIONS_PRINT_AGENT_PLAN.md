# Branch Stations + Premier Print Agent — Execution Plan

## Scope lock
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Working branch: `development/branch-stations-print-agent-v2`
- Preserve all existing working flows and current user data.
- No direct `main` changes, no force push, no RLS/test weakening, and no Production migration before Full Verify Green plus explicit approval.

## Target model
`Agent identity -> allowed branches -> selected branch -> branch stations -> category/user assignments -> print jobs -> local Windows printers`

## Concurrency rule
Before every implementation batch: fetch current `main`, compare this branch, inspect overlapping files/contracts, and stop/reconcile if another program touched the same area. Never overwrite concurrent work.

## Phase 1 — Audit current working contracts
Document the actual station tables/RPCs/RLS, category and user assignments, `send_to_kitchen` routing, current printer settings, print queue, claim/retry/complete semantics, and local/Electron agent code. No schema change until this map is complete.

## Phase 2 — Branch-owned stations
Every station must belong to exactly one branch. Station names may repeat between branches. Category and user assignments must be constrained to the same branch at DB-contract level. Existing valid data must be preserved; ambiguous legacy rows must never be silently rewritten.

## Phase 3 — Safe migration only if required
Use additive changes where possible. Backfill only deterministic mappings. Fail safely on ambiguous/orphan/cross-branch data. Add regression and RLS tests before Production consideration.

## Phase 4 — Settings UI
Authorized settings users select an allowed branch, see only its stations, and manage station active state, categories, and users. Cross-branch values must be rejected by backend/RLS, not merely hidden by UI.

## Phase 5 — Windows Agent branch discovery
The agent authenticates without a service-role key or DB password, lists only allowed branches, lets an authorized operator choose one, stores the selection locally, and protects branch changes behind settings authorization.

## Phase 6 — Dynamic station discovery
After branch selection, load the branch's active stations dynamically. No hard-coded `kitchen/barista/cashier` list. New stations such as shisha must appear without rebuilding the app.

## Phase 7 — Local printer mapping
Enumerate Windows printers and map `station_id -> local Windows printer`. Provide Test Print and status. Device-specific printer names remain local unless a proven existing contract requires otherwise.

## Phase 8 — Existing print queue integration
Prefer the existing queue. Jobs must be branch/station attributable, claims atomic, branch-scoped and idempotent. A retry may retry printing only and must never repeat `send_to_kitchen`, inventory, order, or payment mutations. Submission/spooling is not falsely reported as physical paper success.

## Phase 9 — Fault isolation
Each station/printer is independently processable. One offline printer must not block other stations. Validate disconnect/reconnect, printer outage/recovery, agent restart, Windows restart, and duplicate claim attempts.

## Phase 10 — Acceptance
Test a real flow: phone/captain -> order -> `send_to_kitchen` -> branch station routing -> print job -> branch Windows Agent -> mapped printer. Then test two branches for strict isolation and settings permissions.

## Verification gate
Run lint, typecheck, unit, integration, schema/fresh DB when schema changes, RLS/security, build, browser smoke, branch/station isolation tests, and print idempotency/retry tests. No weakening tests to obtain Green.

## Production gate
Re-fetch latest `main`, reconcile concurrent work, review final diff, open focused PR, require Full Verify Green, then present exact migration/data-impact report. Production `azzdesuowpdcoflmyezn` remains untouched until explicit approval.

## Definition of Done
- stations are truly branch-owned
- category/user assignments are branch-safe
- working data/flows are preserved
- agent discovers only allowed branches
- agent dynamically loads selected-branch stations
- authorized operator maps each station to a local Windows printer
- agent starts with Windows/background
- agent pulls only selected-branch/station jobs
- one printer failure does not block others
- retries do not duplicate completed prints or business mutations
- printer settings are permission protected
- multi-branch RLS/isolation tests pass
- Full Verify Green
- Production changes only after explicit approval
