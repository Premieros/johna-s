# POS Duplicate Persisted Line Identity Hotfix — 2026-09-29

Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `hotfix/pos-duplicate-line-identity-20260929`
PR: `#407`
Production baseline: `62daffd608b7e0dba4052157a8b3bd6b4e9022bc`

## State
**VERIFYING**

## Incident
Smouha branch reported that after moving an item from Table 27, the operator could not move it again or remove/Void it.

Production read-only evidence showed:
- the first transfer succeeded;
- moved sent lines preserved kitchen history and did not re-deduct inventory;
- later attempts by Super Admin `eslam` stopped before transfer/Void RPC execution;
- the source order contained two persisted Water rows with the same product/modifiers/note configuration but different `order_items.id` values and quantities;
- the client configuration-only line key made those rows ambiguous.

## Root cause
Persisted order rows were reconstructed into `CartItem` without retaining `order_items.id`. UI selection, sent-state matching, transfer lookup and Void lookup therefore depended on product + modifiers + note only. Two persisted rows with the same configuration became indistinguishable even though the database correctly maintained distinct rows.

## Hotfix
- add optional `order_item_id` to `CartItem`;
- retain `order_items.id` when rebuilding a cart from a persisted order;
- keep persisted row identity separate from cart configuration identity;
- use exact row id for sent state, transfer, split, Void and availability when available;
- preserve row identity through the workspace edit path;
- add regression coverage for two identical persisted Water rows with quantities 4 and 5.

## Safety boundaries
- no direct write to `main`;
- no force push;
- no Production data write;
- no database migration;
- no inventory deduction logic change;
- no send-to-kitchen/KDS routing change;
- no printing or Print Agent change;
- no payment or shift change;
- exact-head verification required before merge;
- merge requires explicit user approval.

## Verification ledger
- Production root-cause inspection: read-only ✅
- Main baseline unchanged during branch creation: ✅
- Focused regression test added: ✅
- First Verify run #36599677700: stopped only by active-worklog branch gate because CURRENT_WORK_PLAN still pointed at the prior costing hotfix.
- Full Verify on corrected active-worklog head: pending.

## Definition of done
- active-worklog gate passes on this exact PR head;
- lint, typecheck, unit tests and build pass;
- DB/browser jobs pass or are proven unaffected according to repository CI;
- changed-file audit contains no migration, printing, KDS, inventory mutation, payment or shift files;
- no merge before user approval.
