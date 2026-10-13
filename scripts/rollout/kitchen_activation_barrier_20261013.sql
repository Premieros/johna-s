-- Run inside the SAME transaction as activation/rollback; never separately.
-- No DML/DDL/ACL change. NOWAIT fails closed if any relevant writer owns a lock.
LOCK TABLE public.orders, public.stock_counts, public.purchases,
  public.warehouse_transfers, public.raw_material_batches,
  public.raw_material_inventory, public.inventory_ledger,
  public.raw_fifo_debts, public.raw_fifo_settlements,
  public.raw_fifo_debt_price_estimates IN EXCLUSIVE MODE NOWAIT;
