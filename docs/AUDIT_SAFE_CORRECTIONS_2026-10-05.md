# AUDIT SAFE CORRECTIONS — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/audit-safe-read-display-20261005`
Current PR: `#446`
Last updated: 2026-10-05

Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED**
Implementation and verification in progress; Production apply is gated.

## Guardrails
User approved the proposed audit corrections, emphasizing live branch continuity.
No business-data edits or transaction tests on Production. No printing, POS,
KDS, FIFO, journal posting or shift changes. No new SECURITY DEFINER helper.
Full Verify must pass on the exact PR head before merge.

## Baseline
Main `08035a784d3c3f43abe68b428c636abb26c004d1`, PR #444 merged.
Read-only Production migration-history verification confirms the previous
dashboard RLS performance migration was applied as `20261004104251`.

## Root-cause ledger
- Net Collection uses net invoice value rather than net paid value.
- Tenant user counts use empty organization_members rather than the users shown
  in the user list with branch organization fallback.
- Raw stock treats negative quantities as zero in its status label.
- Branch cache is indefinitely reused until an in-session change or reload.
- Supplier/purchase SELECT policies use branch scope without feature checks.
  Supplier reads are dependencies of purchasing, RFQ, low-stock, costing and
  accounting. UPDATE requires SELECT: blanket view-only restrictions may block
  authorized writes. Isolate the policy change until dependencies are covered.

## Change ledger
- Sales report retains net sales and displays net collection from paid_amount
  minus refunded_amount, using existing canonical numeric helpers.
- Tenant counts use the Users tab's active-membership/primary-branch association,
  counting each existing user once. Read failures show unavailable/retry rather
  than fabricated zero totals.
- Negative raw stock is labelled Negative balance; quantity/FIFO is unchanged.
- Branch reads refresh on visible-window resume, coalesced and throttled to 30s.
  Unchanged rows retain array identity to avoid downstream reloads. Transient
  background failures preserve current branch context. No interval polling.

## Verification ledger
- Local typecheck:all passed; identity lock and API contract passed.
- Local lint passed (existing warnings); production build passed.
- Unit/component baseline run: 285 files / 1402 tests passed.
- Added regression tests cover unpaid/partial sales collection, missing tenant
  memberships, active membership precedence, read failure, revoked branch
  resume refresh, request coalescing and context retention on network failure.
- Final exact-head Full Verify remains pending; no Production schema writes.

## Production gate
State: **BLOCKED**
No Production migration included in the display patch. Permission hardening is
separate and not applied until dependency regression evidence is complete.

## Next action
Wait for exact-head Full Verify on PR #446; merge only if all jobs are Green.
Permission policy hardening and FIFO debt costing review remain separate.

## Mandatory update protocol
Verify branch HEAD before sequential remote writes. Reconcile interruptions.
Record exact-head results and deployment state without editing business data.
