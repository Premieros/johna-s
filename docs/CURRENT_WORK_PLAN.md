# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Hotfix — canonical theoretical costing source**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Production baseline at start: `a1b8e77d5e1b0466d78f4d72170a9a1c9f22ebbf`
- Active development branch: `hotfix/costing-theoretical-source-20260928`
Mandatory active work log: `docs/COSTING_THEORETICAL_HOTFIX_2026-09-28.md`

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
Correct the Costing Center theoretical-cost source so it no longer reads the retired/unused `product_components` BOM. Theoretical product cost must use the canonical current recipe/raw-material model, including linked manufactured component groups. Historical COGS remains unchanged.

Operational stock deduction, send-to-kitchen, printing, Print Agent, routing, KDS, shifts, payments, and production data remain frozen.

Detailed findings, change ledger, verification, and production gate are maintained only in:
`docs/COSTING_THEORETICAL_HOTFIX_2026-09-28.md`

## Definition of done
This defect-fix track is complete only when:
- decimal quantity entry is covered by focused UI/unit verification;
- linked component-group costing is covered by DB/integration verification;
- Full Verify is Green on the exact final head;
- Production API parity remains Green;
- no POS deduction, send-to-kitchen, printing/KDS/agent behavior changed;
- Production migration is not applied before explicit approval.

> All older work-plan sections and historical logs remain archival evidence only. They are not active execution instructions.
