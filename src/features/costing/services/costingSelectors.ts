import { supabase } from '@/api';
import { fetchAllReportRows } from '@/features/reporting/fetchAllReportRows';
import type { MeasurementUnitDisplay } from '@/lib/format';

export type CostingBranchOption = { id: string; name: string };
export type CostingSupplierOption = { id: string; name: string };

export async function loadCostingBranches(): Promise<CostingBranchOption[]> {
  const result = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
  if (result.error) throw result.error;
  return (result.data as CostingBranchOption[] | null) || [];
}

export async function loadCostingSuppliers(branchId: string | null = null): Promise<CostingSupplierOption[]> {
  let query = supabase.from('suppliers').select('id, name').order('name');
  if (branchId) query = query.eq('branch_id', branchId);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data as CostingSupplierOption[] | null) || [];
}

export async function loadRawMaterialUnitDisplayMap(branchId: string | null = null): Promise<Record<string, MeasurementUnitDisplay>> {
  let materialsQuery = supabase.from('raw_materials').select('id, unit_id').order('id');
  if (branchId) materialsQuery = materialsQuery.eq('branch_id', branchId);
  const [materials, unitsRes] = await Promise.all([
    fetchAllReportRows(materialsQuery).catch(() => []),
    supabase.from('measurement_units').select('id, code, name, symbol'),
  ]);
  if (unitsRes.error) return {};

  const unitsById = new Map<string, MeasurementUnitDisplay>();
  for (const unit of (unitsRes.data || []) as Array<{ id: string; code: string; name: string; symbol: string | null }>) {
    unitsById.set(unit.id, unit);
  }

  const next: Record<string, MeasurementUnitDisplay> = {};
  for (const material of materials as Array<{ id: string; unit_id: string | null }>) {
    if (!material.unit_id) continue;
    const unit = unitsById.get(material.unit_id);
    if (unit) next[material.id] = unit;
  }
  return next;
}
