# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Emergency Hotfix — POS duplicate persisted line identity**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Production baseline at start: `62daffd608b7e0dba4052157a8b3bd6b4e9022bc`
- Active development branch: `hotfix/pos-duplicate-line-identity-20260929`
Mandatory active work log: `docs/POS_DUPLICATE_LINE_IDENTITY_HOTFIX_2026-09-29.md`

## Repository branch policy
Only these long-lived branches are intentionally preserved:
1. `main`
2. `development/cleopatra-v811-final`
3. `development/smouha-v811-realtime-final`

All normal development branches are temporary and should be deleted after verified merge/closure.

## Active PR policy
Only the two latest Print Agent PRs are intentionally retained outside the current stability PR:
- #365 — Cleopatra V8.1.1 final
- #357 — Smouha V8.1.1 final

Older PRs/branches are historical and must not be used as execution baselines.

## Safety fence
- السجل هو المرجع الإجباري للعمل.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو ناقص أو لا يطابق فرع الـPR.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Single writer on the active development branch.
- No direct write to `main`.
- No force push.
- Unexpected HEAD => **STOP_AND_RECONCILE**.
- No weakening Permission-First, branch isolation, RLS, tests, or Super Admin implicit-bypass rules.
- Printing / Print Agent / routing / KDS / kitchen dispatch are frozen unless a separately proven regression requires a reviewed fix.
- No Production data rewrite/reset/reseed to make tests pass.
- Runtime changes must remain safe for currently operating branches.

## Current objective
Repair the live POS ambiguity that occurs when table-item transfer creates or exposes two persisted `order_items` rows with the same product/modifier/note configuration. Each resumed/server-backed cart row must remain independently addressable by its exact `order_items.id` so transfer, re-transfer, split and sent-item Void target the intended row.

No database migration or Production data rewrite is part of this hotfix. Inventory deduction, send-to-kitchen, printing, Print Agent, KDS routing, payments and shifts remain frozen.

Detailed findings, change ledger, verification, and production gate are maintained only in:
`docs/POS_DUPLICATE_LINE_IDENTITY_HOTFIX_2026-09-29.md`

## Definition of done
This hotfix is complete only when:
- duplicate persisted POS lines remain independently addressable after resume/transfer;
- exact-line transfer and sent-item Void use the persisted `order_item_id` when available;
- focused regression coverage reproduces identical persisted Water rows;
- Full Verify is Green on the exact final head;
- changed-file audit contains no migration, printing, KDS, inventory mutation, payment or shift changes;
- no merge occurs before explicit approval.

> All older work-plan sections and historical logs remain archival evidence only. They are not active execution instructions.
