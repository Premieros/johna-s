# Johna's incident — 2026-11-12

## Evidence and restoration
- Project: azzdesuowpdcoflmyezn; repository: Premieros/johna-s.
- Broad database timeouts affected order saves, kitchen sends, shift reads and dashboard queries.
- Supabase metrics for the incident showed approximately 432 MB RAM, 771 MB swap at 20:16 Cairo, and IOwait 81.34% at 20:19 Cairo. Memory commitment was flagged Severe. This establishes resource pressure, not the initiating cause.
- Resetting pg_stat_statements at 18:16:47 UTC did not resolve the incident. Historical query measurements before that reset are lost.
- Narrow cancellation attempts found no eligible active read queries. Three policy migration attempts failed atomically because operational tables were locked; live policy hashes remained unchanged before the final application. One failed attempt included release of eligible idle direct order-list read sessions; no affected-session count was captured.
- Fast database reboot requested through the Supabase dashboard. Database restart verified by pg_postmaster_start_time(): 2026-11-12 18:31:00.731022 UTC.
- Successful recovery check: browser POS loaded products, tables, and 20 active orders; latest database check at 18:32:40 UTC found zero active authenticated requests older than 10 seconds. This is point-in-time recovery, not proof of sustained performance.
- No application release, paid upgrade, data deletion, or permission expansion was performed.

## Applied SQL optimization
Migration 20261112183157_pos_read_permission_initplans is already applied to production.
Only two SELECT policies changed: auth_select_order_items and auth_select_order_kitchen_sends.
Invariant functions are evaluated through uncorrelated SELECT/initplans. All original predicates, roles, and restrictive financial policies remain.

Validation:
- Before: bounded authenticated open/held order read, 22 orders, execution 336.467 ms, 5,263 buffer hits.
- Rolled-back trial: identical visible item ID set for the tested operator; same 22 orders, execution 86.024 ms, 2,077 buffer hits. Timing varies with server pressure; buffer reduction and one-time initplan loops establish reduced repeated work.
- After reboot, before policy application: 20 live orders, execution 213.285 ms, planning 4.475 ms.
- Final live policy definitions verified after applying migration.
- Security/performance advisors retrieved; existing warnings remain (RLS/initplan, foreign keys, function grants, etc.). No blanket advisor cleanup was attempted during the incident.

## Rollback
Reapply the original SELECT expressions only (preserving all other policies):
```sql
BEGIN;
SET LOCAL lock_timeout='500ms';
LOCK TABLE public.order_items, public.order_kitchen_sends IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER POLICY auth_select_order_items ON public.order_items USING (
 EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_items.order_id
 AND public.user_may_access_branch(o.branch_id)
 AND (o.cashier_id=auth.uid() OR public.can_manage_other_pos_orders() OR public.can_permission('pos.kds_view')))
);
ALTER POLICY auth_select_order_kitchen_sends ON public.order_kitchen_sends USING (
 public.is_pos_admin() OR (branch_id=public.get_branch_id()
 AND (public.can_permission('pos.view') OR public.can_permission('pos.kds_view')))
);
COMMIT;
```

## Open investigation
The initiating workload or change is not identified. Latest manual print recovery PR #632 adds user-invoked functions and its dialog loads only on opening; this review does not prove it is unrelated. Investigate resource history before the incident and repeat recovery checks under real branch workload. Do not treat successful deployment checks or a healthy project metadata status as proof of application availability.
