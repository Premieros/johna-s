import { supabase } from '@/api';

export type InventoryUnitComponentRow = {
  id?: string;
  raw_material_id: string;
  quantity: number;
  wastage_percent: number;
};

export type InventoryUnitRawMaterialOption = {
  id: string;
  name: string;
  branch_id: string | null;
  unit_id: string | null;
  measurement_unit?: { id: string; name: string; symbol?: string | null; code?: string | null } | null;
};

export async function saveInventoryUnit(params: {
  id?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const query = params.id
    ? supabase.from('inventory_units').update(params.payload).eq('id', params.id)
    : supabase.from('inventory_units').insert({ ...params.payload, unit_type: 'manufactured' as const });
  const { error } = await query;
  if (error) throw error;
}

export async function loadInventoryUnitComponents(params: {
  unitId: string;
  branchId: string;
}): Promise<{
  rawMaterials: InventoryUnitRawMaterialOption[];
  components: InventoryUnitComponentRow[];
  errors: string[];
}> {
  let rawMaterialQuery = supabase
    .from('raw_materials')
    .select('id,name,branch_id,unit_id,measurement_unit:measurement_units!raw_materials_unit_id_fkey(id,name,symbol,code)')
    .eq('is_active', true);
  if (params.branchId) rawMaterialQuery = rawMaterialQuery.eq('branch_id', params.branchId);

  const [rawResult, componentResult] = await Promise.all([
    rawMaterialQuery.order('name'),
    supabase
      .from('inventory_unit_recipes')
      .select('id,raw_material_id,quantity,wastage_percent')
      .eq('unit_id', params.unitId)
      .order('created_at'),
  ]);

  return {
    rawMaterials: (rawResult.data as unknown as InventoryUnitRawMaterialOption[]) || [],
    components: (componentResult.data as InventoryUnitComponentRow[]) || [],
    errors: [rawResult.error?.message, componentResult.error?.message].filter(Boolean) as string[],
  };
}

export async function saveInventoryUnitComponents(unitId: string, rows: InventoryUnitComponentRow[]): Promise<void> {
  const { error: deleteError } = await supabase.from('inventory_unit_recipes').delete().eq('unit_id', unitId);
  if (deleteError) throw deleteError;

  if (!rows.length) return;
  const { error: insertError } = await supabase.from('inventory_unit_recipes').insert(rows.map((row) => ({
    unit_id: unitId,
    raw_material_id: row.raw_material_id,
    quantity: Number(row.quantity),
    wastage_percent: Number(row.wastage_percent) || 0,
  })));
  if (insertError) throw insertError;
}

export async function deleteComponentGroup(id: string): Promise<void> {
  const { error } = await supabase.from('inventory_units').delete().eq('id', id);
  if (error) throw error;
}
