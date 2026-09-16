-- Employee receivables correction from the approved source reports:
--   cl 1-14 (1).xlsx + cl 15.xls.xlsx
-- Scope: Smouha branch employee receivables only.
-- This script is intentionally NOT a migration and must not be run automatically.
-- Run only after application verification and explicit Production approval.

begin;

-- 1) Guard the exact Production branch population before touching data.
do $$
declare
  v_branch uuid := '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid;
  v_employee_count integer;
begin
  select count(*) into v_employee_count
  from public.customers
  where branch_id = v_branch and customer_type = 'employee';

  if v_employee_count <> 17 then
    raise exception 'EMPLOYEE_POPULATION_MISMATCH: expected 17, found %', v_employee_count;
  end if;
end $$;

-- 2) Remove only the erroneous pre-September opening balances from the bad import.
--    Historical September transactions are preserved intact.
delete from public.employee_receivable_entries e
using public.customers c
where e.customer_id = c.id
  and e.branch_id = c.branch_id
  and c.branch_id = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid
  and c.customer_type = 'employee'
  and e.entry_type = 'opening_balance'
  and e.reference_number like 'OPENING-EMP-%'
  and e.occurred_at < timestamptz '2026-09-01 00:00:00+03';

-- 3) Add the day-15 source transactions that were absent from the previous import.
--    Existing transactions are protected by the unique business key and ON CONFLICT.
with missing(name, reference_number, amount) as (
  values
    ('Chef Ahmed', '12674', 175.00::numeric),
    ('M Eslam', '12607', 10.00::numeric),
    ('M Wasem', '12702', 100.00::numeric),
    ('mohamed c', '12620', 20.00::numeric),
    ('احمد السعدني', '12699', 10.00::numeric),
    ('ملك', '12694', 100.00::numeric)
), resolved as (
  select c.id as customer_id, c.branch_id, m.reference_number, m.amount
  from missing m
  join public.customers c
    on c.name = m.name
   and c.customer_type = 'employee'
   and c.branch_id = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid
)
insert into public.employee_receivable_entries (
  branch_id, customer_id, occurred_at, reference_number, entry_type,
  amount, settled_amount, notes, created_by
)
select
  branch_id,
  customer_id,
  timestamptz '2026-09-15 12:00:00+03',
  reference_number,
  'historical_charge',
  amount,
  0,
  'Corrected from approved employee receivables source report for 2026-09-15; not a POS sale',
  auth.uid()
from resolved
on conflict (branch_id, customer_id, entry_type, reference_number) do nothing;

-- 4) Hard verification: every employee balance must equal the approved source total.
do $$
declare
  v_branch uuid := '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid;
  r record;
  v_actual numeric;
begin
  for r in
    select * from (values
      ('Chef Ahmed', 595.00::numeric),
      ('Eslam nady', 75.00::numeric),
      ('Gana', 190.00::numeric),
      ('kariman', 25.00::numeric),
      ('M Eslam', 1527.00::numeric),
      ('M Wasem', 1130.45::numeric),
      ('Mariam cap', 590.00::numeric),
      ('mohamed c', 80.00::numeric),
      ('Mr George', 405.00::numeric),
      ('Rewan', 295.00::numeric),
      ('احمد السعدني', 830.00::numeric),
      ('بلال محمد', 75.00::numeric),
      ('شيف خالد', 448.00::numeric),
      ('عبدالفتاح', 50.00::numeric),
      ('محمد ياسر', 25.00::numeric),
      ('مصطفى فهمى', 725.00::numeric),
      ('ملك', 755.00::numeric)
    ) as expected(name, expected_open)
  loop
    select coalesce(sum(e.amount - e.settled_amount), 0)
      into v_actual
    from public.employee_receivable_entries e
    join public.customers c on c.id = e.customer_id
    where c.branch_id = v_branch
      and c.customer_type = 'employee'
      and c.name = r.name;

    if round(v_actual, 2) <> round(r.expected_open, 2) then
      raise exception 'BALANCE_MISMATCH for %: expected %, got %', r.name, r.expected_open, v_actual;
    end if;
  end loop;
end $$;

-- Leave reviewable output in SQL clients.
select c.name,
       round(coalesce(sum(e.amount - e.settled_amount), 0), 2) as corrected_open_balance,
       count(e.id) as transaction_count
from public.customers c
left join public.employee_receivable_entries e
  on e.customer_id = c.id and e.branch_id = c.branch_id
where c.branch_id = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid
  and c.customer_type = 'employee'
group by c.id, c.name
order by c.name;

commit;
