# DISCOUNT APPROVAL RELIABILITY — ACTIVE WORK LOG

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/discount-approval-realtime-apply-20260930`
Current PR: `#411`
Last updated: 2026-09-30

## Work status
State: **BLOCKED**

## Guardrails
- Do not touch printing, Print Agent, KDS, treasury, settlement amounts, or inventory.
- Preserve existing discount permission and approval rules.
- Do not grant new approval permissions.
- Cashier discount must apply only after the exact approval request is approved.
- Approved value must come from the stored approval payload.
- No direct main write, no force push, no Production migration without exact-head Green + explicit approval.

## Baseline
- Base main: `dc2cfe2ada2d495b037fdf48430af501c7a97fa1`.
- Production DB: `azzdesuowpdcoflmyezn`.
- Realtime publication already includes `approval_requests`.
- Production has recent Cleopatra discount requests that reached `approved` but were not consumed/applied.

## Root-cause ledger
- ApprovalInbox required `user.branch_id`; global/super-admin reviewers without a fixed branch could use Approval Center but receive no inbox notification.
- Cashier discount UI relied on receiving one Realtime UPDATE while the component was mounted.
- Missing that event left the request approved in DB while the cashier UI remained unchanged.
- Approval Center correctly records the approval; the unreliable client handoff is the defect.

## Change ledger
- ApprovalInbox now loads manager approvals from `get_operational_approval_queue(NULL)`, matching Approval Center accessible-branch semantics.
- ApprovalInbox subscribes to approval-request changes without requiring a fixed reviewer branch.
- Discount approval card still uses Realtime, plus a temporary 3-second exact-request status check only while pending and a focus refresh.
- On approval, the UI applies the exact stored `requested_value` / `discount_type` from the approval payload once.
- Added regression test `tests/unit/discountApprovalReliability.test.ts`.

## Verification ledger
- Production read-only confirmed recent approved-but-not-consumed discount requests in Cleopatra.
- Production read-only confirmed `approval_requests` is in `supabase_realtime`.
- Production RLS allows requester to read own request and authorized reviewer to read accessible-branch requests.
- Exact-head CI pending.

## Production gate
State: **BLOCKED**
- No Production changes for this fix yet.
- No merge until exact-head Fast Verify + Full Verify Green and explicit approval.

## Next action
1. Open Draft PR.
2. Run Fast Verify and Full Verify on exact head.
3. Verify no Print/KDS/treasury files changed.
4. Stop before merge for explicit approval.

## Mandatory update protocol
- Verify HEAD before repository writes.
- Unexpected HEAD movement => STOP_AND_RECONCILE.
- Keep this file and CURRENT_WORK_PLAN synchronized.
- Record exact-head CI results.
- لا Merge ولا Production migration قبل التحقق الكامل والموافقة الصريحة.
