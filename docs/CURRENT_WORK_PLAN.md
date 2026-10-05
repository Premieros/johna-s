# CURRENT WORK PLAN — johna-s — SOURCE OF TRUTH

## Active work
- Track: **Approved audit corrections with live-branch continuity**
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Latest main baseline reconciled: `08035a784d3c3f43abe68b428c636abb26c004d1`
- Current active branch: `fix/audit-safe-read-display-20261005`
- Mandatory active work log: `docs/AUDIT_SAFE_CORRECTIONS_2026-10-05.md`

## Operational rules
- السجل هو المرجع الإجباري للعمل، وهذا الملف يحدد المسار النشط الوحيد.
- CI يجب أن يفشل إذا كان السجل الإلزامي مفقودًا أو لا يطابق المسار النشط.
- Single writer on the active branch.
- No direct write to `main`; no force push.
- Unexpected branch HEAD or latest-main movement => **STOP_AND_RECONCILE**.
- لا Merge ولا Production migration قبل exact-head Full Verify Green + موافقة صريحة.
- Any Production apply requires separate explicit approval.
- Preserve Permission-First, branch isolation, Financial Visibility and current operational truth.
- Printing, Print Agent, POS transactions, KDS, Send to Kitchen, stock posting, Accounting, Settlement and Shifts remain frozen. Inventory status wording is approved.

## Current objective
Correct sales report collection columns, tenant user counts and negative stock labels; verify branch refresh separately. User approved these corrections on 2026-10-05 and requires continuity of live branch operations. Permission policy hardening is isolated until dependent operational reads have safe replacement paths.

## Verified state
- PR #444 is merged at the reconciled main baseline above.
- Read-only Production migration-history inspection confirms `20261004104251 / dashboard_sales_rls_context_cache` was applied. The prior worklog's pre-apply BLOCKED state is historical.
- Current audit/fix work uses Production for read-only diagnostics.
- Current wide-range Dashboard baseline for a branch manager is approximately 3.73 s with ~93k shared buffer hits.
- Current isolated sale visibility predicate is approximately 455 ms / 10,849 shared hits.
- Equivalent statement-context predicate is approximately 120 ms / 3,886 shared hits.
- Row-by-row comparison over 1,854 Production sales produced 0 visibility mismatches for branch_manager, super_admin and cashier personas.
- No Production DDL or migration has been applied by this audit/fix work.

## Remaining gated work
- Exact-head CI must be fully green.
- This display patch includes no database migration.
- Permission changes require dependency tests before Production application.
