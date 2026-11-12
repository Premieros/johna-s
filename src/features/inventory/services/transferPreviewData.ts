import { supabase } from '@/api';

/** The inventory page uses this exact view, never a separate cached balance. */
export async function loadTransferSourceBalances(
  branchId: string,
  warehouseId: string,
  rawMaterialIds: readonly string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(rawMaterialIds.filter(Boolean))];
  if (!branchId || !warehouseId || !ids.length) return {};
  const { data, error } = await supabase.from('raw_material_warehouse_inventory')
    .select('raw_material_id,quantity')
    .eq('branch_id', branchId)
    .eq('warehouse_id', warehouseId)
    .in('raw_material_id', ids);
  if (error || !Array.isArray(data)) throw new Error('TRANSFER_BALANCE_UNAVAILABLE');
  const balances: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  for (const row of data) {
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty)) throw new Error('TRANSFER_BALANCE_INVALID');
    balances[row.raw_material_id] = qty;
  }
  return balances;
}

export interface PendingTransferItem {
  id: string;
  raw_material_id: string | null;
  destination_raw_material_id: string | null;
  product_id: string | null;
  quantity: number;
  unit_cost: number;
}

export async function loadTransferPendingItems(transferId: string): Promise<PendingTransferItem[]> {
  const { data, error } = await supabase.from('warehouse_transfer_items')
    .select('id,raw_material_id,destination_raw_material_id,product_id,quantity,unit_cost')
    .eq('transfer_id', transferId)
    .order('id');
  if (error || !Array.isArray(data)) throw new Error('TRANSFER_ITEMS_UNAVAILABLE');
  if (!data.length) throw new Error('TRANSFER_ITEMS_EMPTY');
  return data.map(item => {
    const quantity = Number(item.quantity);
    const unit_cost = Number(item.unit_cost);
    if (!Number.isFinite(quantity) || !Number.isFinite(unit_cost)) throw new Error('TRANSFER_ITEMS_INVALID');
    return { ...item, quantity, unit_cost };
  });
}
