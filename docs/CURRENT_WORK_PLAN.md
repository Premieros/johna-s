# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Dashboard / Sales RLS performance**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `3c9e3cf1f2bac05dab346a33b7af53b0adeef77a`
- Active development branch: `perf/dashboard-sales-snapshot-rls`
- Mandatory active work log: `docs/DASHBOARD_SALES_RLS_PERFORMANCE_2026-10-04.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any Production apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and current operational truth.
- Printing, Print Agent, KDS, Send to Kitchen, Inventory, Accounting, Settlement and Shifts remain frozen.

## Current objective
Remove repeated row-level authorization work from Dashboard/Sales reads while preserving exactly the existing Financial Visibility result set for every authenticated user.

## Verified state
- Production was used only for read-only diagnostics.
- Current wide-range Dashboard baseline for a branch manager is approximately 3.73 s with ~93k shared buffer hits.
- Current isolated sale visibility predicate is approximately 455 ms / 10,849 shared hits.
- Equivalent statement-context predicate is approximately 120 ms / 3,886 shared hits.
- Row-by-row comparison over 1,854 Production sales produced 0 visibility mismatches for branch_manager, super_admin and cashier personas.
- No Production DDL or migration has been applied.

## Remaining gated work
- Exact-head CI must be fully green.
- Supabase Preview/Staging validation is required before any Production proposal.
- Preview branch cost must be explicitly accepted before creation.
- Full after-migration Dashboard, sale_items and sale_payments benchmarks plus 57014/HTTP 500 verification are still required.
