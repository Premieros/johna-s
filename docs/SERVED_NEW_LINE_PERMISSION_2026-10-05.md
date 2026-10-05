# SERVED NEW LINE PERMISSION — ACTIVE WORK LOG
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `fix/served-new-line-permission-20261005`
Current PR: `#450`
Last updated: 2026-10-05

## Work status
State: **BLOCKED**
Isolated permission guard fix in verification; Production unchanged.

## Guardrails
Permission-First only: pos.send_kitchen, branch and served-delta evidence. No role-name exception.
No grants/RLS changes, new SECURITY DEFINER bypass, POS send core, stock/print changes.
No Production SQL apply or merge before exact-head Full Verify and explicit approval.

## Baseline
main b961c6e9f7457f1431ea4594e002de41a6a542a8.
Production SELECT of pg_get_functiondef confirms existing served resend exception uses INNER JOIN.
Report PR #449 remains separate, green, unmerged.

## Root-cause ledger
Brand-new lines have no served baseline, so INNER JOIN discards their positive sent delta.
The trigger falls through to pos.kds_update although send_to_kitchen allows pos.send_kitchen.

## Change ledger
Replace that one delta JOIN with LEFT JOIN and existing COALESCE zero handling.
Require authoritative order-level served baseline. Preserve served->sent and permission gates.
One trigger function only, guarded exact text replacement and idempotence.
Reverse guarded SQL provided; no production business data mutation.

## Verification ledger
Integration regression exercises a sender without KDS permission on another operator's order:
no additions leaves served; new line reopens; only new line in KDS; stock deducted once;
repeat send is no-op; cooking denied. Existing cross-branch tests retained.
Typecheck:all, changed-test lint, API contract and branch-matching worklog gate (4 tests) passed.
Exact-head isolated DB/security/browser CI pending; no local test DB configured.

## Production gate
State: **BLOCKED**
Production apply needs separate explicit approval after passing isolated tests.

## Next action
Complete exact-head CI, present reviewed migration and rollback, then request Production approval.

## Mandatory update protocol
Single writer; no force push or direct main writes. Reconcile unexpected main/head movement.
