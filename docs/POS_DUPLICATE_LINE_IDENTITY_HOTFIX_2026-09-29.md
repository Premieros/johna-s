# POS Duplicate Persisted Line Identity Hotfix — 2026-09-29

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/pos-duplicate-line-identity-20260929`
Current PR: `#407`
Last updated: 2026-09-29 20:00 Africa/Cairo

## Work status
State: **BLOCKED**

Blocked only on exact-head verification. The code fix is complete and remains unmerged.

## Guardrails
- No direct write to `main`.
- No force push.
- No Production data write.
- No database migration.
- No inventory deduction logic change.
- No send-to-kitchen/KDS routing change.
- No printing or Print Agent change.
- No payment or shift change.
- Exact-head Full Verify must be Green before merge.
- Merge requires explicit user approval.

## Baseline
- Production/main baseline: `62daffd608b7e0dba4052157a8b3bd6b4e9022bc`.
- Incident branch: Smouha.
- Reported flow: item moved from Table 27, then could not be moved again or removed/Void.
- Production investigation was read-only.

## Root-cause ledger
1. The first item transfer succeeded.
2. Later attempts by Super Admin `eslam` reached the client-side exact-line lookup but did not invoke transfer/Void RPCs.
3. The order contained two persisted Water rows with the same product/modifiers/note configuration but different `order_items.id` values and quantities.
4. Persisted order rows were reconstructed into `CartItem` without retaining `order_items.id`.
5. UI identity therefore collapsed distinct persisted rows onto the same configuration-only line key.
6. The client correctly refused to guess which persisted row to mutate, causing the operational block.

## Change ledger
- Added optional `order_item_id` to `CartItem`.
- `orderItemsToCart` now retains the authoritative persisted `order_items.id`.
- Added separate configuration identity for unsaved cart grouping and note/modifier comparison.
- Persisted cart line keys now use exact row identity when available.
- Sent-state matching now binds to the exact persisted row.
- Transfer and sent-item Void resolution now prefer `order_item_id`.
- Cart-aware availability now uses exact persisted row identity when present.
- Workspace item editing preserves persisted row identity.
- Added regression coverage for two otherwise identical persisted Water rows with quantities 4 and 5.
- No migration, print, KDS, inventory mutation, payment, or shift file changed.

## Verification ledger
- Production root-cause inspection: read-only ✅
- Main baseline remained unchanged while creating the hotfix branch ✅
- Regression test added ✅
- Verify run `36599677700`: stopped at active-worklog branch mismatch before lint/typecheck.
- Verify run `36599874568`: branch match passed; stopped because the new worklog headings did not match the repository-mandated structure.
- Verify run `36601464412`: repository gates, lint, and app typecheck passed; test typecheck found the regression fixture missing the required `created_at` field.
- The test fixture was corrected by adding only the required `created_at` field. Production logic was not changed by this correction.
- Unit/build and downstream DB/browser jobs remain pending behind the exact-head rerun.

## Production gate
Do not merge or deploy until the exact final hotfix HEAD passes repository Verify, DB, and browser-smoke gates according to the repository workflow. No Production migration is required for this fix.

## Next action
Re-run exact-head verification after this worklog-only correction. If Green, recheck that `main` has not moved unexpectedly, then request/confirm merge approval.

## Mandatory update protocol
Update this log after every material write, verification result, unexpected HEAD change, merge, or deployment result. Keep State **BLOCKED** until the exact final HEAD is fully verified and explicit merge approval is available.
