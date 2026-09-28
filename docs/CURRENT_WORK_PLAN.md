# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Decimal recipe quantities + linked component-group costing defect fix**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Production baseline at start: `69ee1d0c80d43bcdecfdb2a104455eafe7a5349b`
- Active development branch: `development/decimal-costing-composite-20260928`
Mandatory active work log: `docs/DECIMAL_COSTING_COMPOSITE_2026-09-28.md`

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
Fix two bounded defects without changing POS operational flows:
1. allow controlled numeric fields to accept decimal drafts such as `0.050` without collapsing mid-entry;
2. include reusable manufactured component-group raw materials in Costing Center product detail and actual recipe cost.

Operational stock deduction, send-to-kitchen, printing, Print Agent, routing, KDS, shifts, and production data remain frozen.

Detailed findings, change ledger, verification, and production gate are maintained only in:
`docs/DECIMAL_COSTING_COMPOSITE_2026-09-28.md`

## Definition of done
This defect-fix track is complete only when:
- decimal quantity entry is covered by focused UI/unit verification;
- linked component-group costing is covered by DB/integration verification;
- Full Verify is Green on the exact final head;
- Production API parity remains Green;
- no POS deduction, send-to-kitchen, printing/KDS/agent behavior changed;
- Production migration is not applied before explicit approval.

> All older work-plan sections and historical logs remain archival evidence only. They are not active execution instructions.
