-- Employee receivables correction from owner-approved opening balances.
-- Scope: Smouha branch employee receivables only.
-- IMPORTANT: source values are opening balances only; they are not transaction history
-- and have no linked payments.
-- This script is intentionally NOT a migration and must not be run automatically.
-- Run only after Full Verify Green and explicit Production approval.

begin;

-- 1) Guard the exact Production population before touching data.
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

-- 2) Remove ALL previously imported employee receivable ledger rows for this branch.
--    Those rows were created from the source report as if they were transaction history,
--    but the owner confirmed the source is opening-balance-only and has no linked payments.
delete from public.employee_receivable_entries e
using public.customers c
where e.customer_id = c.id
  and e.branch_id = c.branch_id
  and c.branch_id = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid
  and c.customer_type = 'employee';

-- 3) Insert exactly one opening-balance row per employee.
with opening(name, amount) as (
  values
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
), resolved as (
  select c.id as customer_id, c.branch_id, o.name, o.amount
  from opening o
  join public.customers c
    on c.name = o.name
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
  timestamptz '2026-09-15 23:59:59+03',
  'OPENING-EMP-CORRECTED-20260915-' || customer_id::text,
  'opening_balance',
  amount,
  0,
  'Corrected employee opening balance supplied by owner; no linked transaction or payment history',
  auth.uid()
from resolved;

-- 4) Hard verification: one receivable row per employee and exact approved balance.
do $$
declare
  v_branch uuid := '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid;
  r record;
  v_actual numeric;
  v_count integer;
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
    select count(e.id), coalesce(sum(e.amount - e.settled_amount), 0)
      into v_count, v_actual
    from public.employee_receivable_entries e
    join public.customers c on c.id = e.customer_id
    where c.branch_id = v_branch
      and c.customer_type = 'employee'
      and c.name = r.name;

    if v_count <> 1 then
      raise exception 'ENTRY_COUNT_MISMATCH for %: expected 1, got %', r.name, v_count;
    end if;

    if round(v_actual, 2) <> round(r.expected_open, 2) then
      raise exception 'BALANCE_MISMATCH for %: expected %, got %', r.name, r.expected_open, v_actual;
    end if;
  end loop;
end $$;

select c.name,
       round(coalesce(sum(e.amount - e.settled_amount), 0), 2) as corrected_open_balance,
       count(e.id) as opening_entry_count
from public.customers c
left join public.employee_receivable_entries e
  on e.customer_id = c.id and e.branch_id = c.branch_id
where c.branch_id = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid
  and c.customer_type = 'employee'
group by c.id, c.name
order by c.name;

commit;
