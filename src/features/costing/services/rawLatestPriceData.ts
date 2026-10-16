import { measurementUnitLabel, type MeasurementUnitDisplay } from '@/lib/format';
import { supabase } from '@/api';
import { fetchAllReportRows } from '@/features/reporting/fetchAllReportRows';
import { loadRawMaterialDisplayPrices, rawCurrentPrice } from './rawCurrentPriceData';

export type RawLatestPriceRow = {
  raw_material_id: string;
  raw_material_name: string;
  raw_material_code: string | null;
  branch_id: string;
  unit_name: string;
  latest_cost: number | null;
  price_source: string;
  priced_at: string | null;
  reference_number: string | null;
};

/** Current prices need material identities and prices, never stock valuation/history. */
export async function loadRawLatestPriceRows(branchId: string | null): Promise<RawLatestPriceRow[]> {
  let query = supabase.from('raw_materials').select('id,name,code,branch_id,measurement_unit:measurement_units!raw_materials_unit_id_fkey(id,code,name,symbol)').order('id');
  if (branchId) query = query.eq('branch_id', branchId);
  const materials = await fetchAllReportRows(query) as Array<{ id: string; name: string; code: string | null; branch_id: string; measurement_unit?: MeasurementUnitDisplay | null }>;
  const prices = await loadRawMaterialDisplayPrices(branchId, materials.map(row => row.id));
  const byId = new Map(prices.map(row => [row.raw_material_id, row]));
  return materials.map(material => {
    const price = byId.get(material.id);
    // Never attach a stale/foreign branch price to a material.
    const scopedPrice = price?.branch_id === material.branch_id ? price : undefined;
    return {
      raw_material_id: material.id, raw_material_name: material.name,
      raw_material_code: material.code, branch_id: material.branch_id,
      unit_name: material.measurement_unit ? measurementUnitLabel(material.measurement_unit) : '',
      latest_cost: rawCurrentPrice(scopedPrice),
      price_source: scopedPrice?.price_source || 'unpriced',
      priced_at: scopedPrice?.priced_at || null,
      reference_number: scopedPrice?.reference_number || null,
    };
  });
}
