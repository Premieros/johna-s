-- Support raw-material rows in the existing stock count document without changing stock twice.
-- Product counts remain backward-compatible.

alter table public.stock_count_items
  alter column product_id drop not null;

alter table public.stock_count_items
  add column if not exists raw_material_id uuid references public.raw_materials(id) on delete restrict;

alter table public.stock_count_items
  drop constraint if exists stock_count_items_one_item_kind_check;

alter table public.stock_count_items
  add constraint stock_count_items_one_item_kind_check
  check (num_nonnulls(product_id, raw_material_id) = 1);

create unique index if not exists stock_count_items_stock_count_raw_material_uidx
  on public.stock_count_items(stock_count_id, raw_material_id)
  where raw_material_id is not null;

create index if not exists stock_count_items_raw_material_idx
  on public.stock_count_items(raw_material_id)
  where raw_material_id is not null;

comment on column public.stock_count_items.raw_material_id is
  'Raw material counted on this stock-count document. Exactly one of product_id/raw_material_id must be set.';

-- Backfill the already-applied Smouha opening inventory into a visible stock-count document.
-- IMPORTANT: this only creates document/header/items from existing ledger rows; it does not alter inventory.
do $$
declare
  v_branch_id uuid := '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid;
  v_warehouse_id uuid := '04348dcc-d24c-4b77-99e5-5c6e29551eec'::uuid;
  v_reference text := 'OPENING-SMOUHA-2026-09-01';
  v_count_id uuid;
begin
  if exists (
    select 1
    from public.inventory_ledger l
    where l.branch_id = v_branch_id
      and l.raw_material_id is not null
      and l.reference_type = 'opening_inventory'
      and l.reference_number = v_reference
  ) then
    select id into v_count_id
    from public.stock_counts
    where count_number = v_reference
      and branch_id = v_branch_id
    limit 1;

    if v_count_id is null then
      insert into public.stock_counts (
        count_number,
        branch_id,
        warehouse_id,
        status,
        count_type,
        notes,
        created_at,
        submitted_at,
        approved_at,
        applied_at
      ) values (
        v_reference,
        v_branch_id,
        v_warehouse_id,
        'applied',
        'full',
        'جرد افتتاحي للخامات - فرع نادي سموحة - مرحل من الرصيد الافتتاحي المسجل بتاريخ 01/09/2026 بدون إعادة تطبيق المخزون',
        '2026-08-31 21:00:00+00'::timestamptz,
        '2026-08-31 21:00:00+00'::timestamptz,
        '2026-08-31 21:00:00+00'::timestamptz,
        '2026-08-31 21:00:00+00'::timestamptz
      ) returning id into v_count_id;
    end if;

    insert into public.stock_count_items (
      stock_count_id,
      product_id,
      raw_material_id,
      system_quantity,
      counted_quantity,
      unit_cost,
      reason
    )
    select
      v_count_id,
      null,
      l.raw_material_id,
      0,
      sum(l.quantity),
      case when sum(l.quantity) <> 0 then round(sum(l.total_cost) / sum(l.quantity), 6) else 0 end,
      'رصيد افتتاحي 01/09/2026'
    from public.inventory_ledger l
    where l.branch_id = v_branch_id
      and l.raw_material_id is not null
      and l.reference_type = 'opening_inventory'
      and l.reference_number = v_reference
    group by l.raw_material_id
    on conflict (stock_count_id, raw_material_id) where raw_material_id is not null
    do update set
      counted_quantity = excluded.counted_quantity,
      unit_cost = excluded.unit_cost,
      reason = excluded.reason;
  end if;
end $$;
