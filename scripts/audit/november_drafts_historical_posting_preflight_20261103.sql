-- Read-only historical count preflight. Never posts quantities, debt, or journals.
BEGIN READ ONLY;
SET LOCAL statement_timeout='3500ms';
with counts as materialized (
select id,count_number,branch_id,warehouse_id,created_at from public.stock_counts where id in ('4d14a222-5fbc-459a-b5b1-b11dba9cf975','8e04fe58-a5d6-4daa-a02d-8dee6245bed5') and status='draft'
), lines as materialized (
select c.*,i.raw_material_id,i.system_quantity,i.counted_quantity from counts c join public.stock_count_items i on i.stock_count_id=c.id
), movements as materialized (
select c.id,l.raw_material_id,count(*) n,sum(l.quantity) delta
from counts c join public.inventory_ledger l on l.branch_id=c.branch_id and l.warehouse_id=c.warehouse_id and l.created_at>c.created_at and l.raw_material_id is not null
group by c.id,l.raw_material_id
), balances as materialized (
select c.id,b.raw_material_id,sum(b.quantity) qty from counts c join public.raw_material_batches b on b.branch_id=c.branch_id and b.warehouse_id=c.warehouse_id group by c.id,b.raw_material_id
), prices as materialized (
select c.id,p.raw_material_id,p.unit_cost from counts c cross join lateral private.latest_approved_raw_prices(c.branch_id,array(select l.raw_material_id from lines l where l.id=c.id),c.created_at) p
), debts as materialized (
select distinct c.id,d.raw_material_id from counts c join public.raw_fifo_debts d on d.branch_id=c.branch_id and d.warehouse_id=c.warehouse_id and d.settled_quantity<d.debt_quantity
)
select l.count_number,count(*) lines,count(*) filter(where m.n>0) moved_since_creation,
count(*) filter(where abs(coalesce(b.qty,0)-coalesce(m.delta,0)-l.system_quantity)>0.0001) baseline_mismatch,
count(*) filter(where d.raw_material_id is not null and l.counted_quantity<>l.system_quantity) variance_with_open_debt,
count(*) filter(where coalesce(p.unit_cost,0)<=0 and l.counted_quantity<>l.system_quantity) unpriced_variances,
round(sum((l.counted_quantity-l.system_quantity)*coalesce(p.unit_cost,0)),2) as snapshot_variance_value
from lines l left join movements m using(id,raw_material_id) left join balances b using(id,raw_material_id) left join prices p using(id,raw_material_id) left join debts d using(id,raw_material_id)
group by l.count_number order by l.count_number;
ROLLBACK;
