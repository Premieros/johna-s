# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Stability Foundation / no feature development**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Production baseline at start: `c22dfd69120201111944c04314b930ca3ad69889`
- Active development branch: `development/stability-foundation-20260928`
Mandatory active work log: `docs/STABILITY_FOUNDATION_2026-09-28.md`

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
Do not add product features. Consolidate the existing system into a stable, maintainable operating baseline:
1. repository/source-of-truth hygiene;
2. internal RPC/security surface hardening;
3. Realtime health diagnosis;
4. current performance baseline and measured fixes;
5. DB-backed Golden Path operational test;
6. containment of oversized/heavy pages behind domain services;
7. offline lifecycle and operational health hardening;
8. CI/runtime environment consistency.

Detailed phase gates, findings, and change ledger are maintained only in:
`docs/STABILITY_FOUNDATION_2026-09-28.md`

## Definition of done
The stability track is complete only when:
- Full Verify is Green on the exact final head;
- Production API parity is Green;
- Golden Path proves POS → kitchen inventory → payment → accounting → shift/day close → treasury/report reconciliation on a fresh DB;
- critical page/RPC latency is bounded by documented budgets;
- no stale active work references remain;
- no unexpected printing/KDS/agent behavior changed.

> All older work-plan sections and historical logs remain archival evidence only. They are not active execution instructions.
