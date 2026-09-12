import type { ApiResult } from '../types';
import { rpc } from '../rpc';
import { supabase } from '../client';

export type CreateRawMaterialInput = {
  p_code: string;
  p_name: string;
  p_unit_id: string;
  p_branch_id?: string | null;
  p_category?: string | null;
  p_min_stock?: number;
  p_default_cost?: number;
  p_description?: string | null;
  p_is_active?: boolean;
};

export type CreateRawMaterialResult = { success?: boolean; error?: string; raw_material_id?: string; branch_id?: string | null };

export type CreateProductInput = {
  p_name: string;
  p_branch_id?: string | null;
  p_name_en?: string | null;
  p_barcode?: string | null;
  p_sku?: string | null;
  p_category_id?: string | null;
  p_description?: string | null;
  p_image_url?: string | null;
  p_cost_price?: number;
  p_sale_price?: number;
  p_wholesale_price?: number;
  p_low_stock_threshold?: number;
  p_min_stock?: number;
  p_max_stock?: number;
  p_reorder_point?: number;
  p_product_type?: 'ready' | 'manufactured';
  p_is_active?: boolean;
  p_units?: { unit_name: string; unit_name_en?: string; conversion_factor?: number; sale_price?: number; cost_price?: number; barcode?: string | null; is_base?: boolean }[] | null;
  p_unit_links?: { unit_id: string; quantity: number }[] | null;
};

export type CreateProductResult = { success?: boolean; error?: string; product_id?: string; branch_id?: string | null };

export const catalog = {
  replaceProductUnits(p: { p_product_id: string; p_units: unknown }): ApiResult<null> { return rpc('replace_product_units', p); },
  createRawMaterial(p: CreateRawMaterialInput): ApiResult<CreateRawMaterialResult> { return rpc('create_raw_material', p); },
  createProduct(p: CreateProductInput): ApiResult<CreateProductResult> { return rpc('create_product', p); },
  getProductModifiers(p_product_id: string): ApiResult<unknown> { return rpc('get_product_modifiers', { p_product_id }); },
  saveProductModifiers(p_product_id: string, p_groups: unknown): ApiResult<unknown> { return rpc('save_product_modifiers', { p_product_id, p_groups }); },

  async listInventoryUnits(filters?: { branch_id?: string; unit_type?: string; is_active?: boolean }) {
    let q = supabase.from('inventory_units').select('*').order('name');
    if (filters?.branch_id) q = q.eq('branch_id', filters.branch_id);
    if (filters?.unit_type) q = q.eq('unit_type', filters.unit_type);
    if (filters?.is_active !== undefined) q = q.eq('is_active', filters.is_active);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async setProductUnitLinks(product_id: string, links: { unit_id: string; quantity: number }[]) {
    const { data: existingLinks, error: existingLinksError } = await supabase
      .from('product_unit_links')
      .select('unit_id')
      .eq('product_id', product_id);
    if (existingLinksError) throw existingLinksError;

    const existingIds = new Set(((existingLinks || []) as { unit_id: string }[]).map((row) => row.unit_id));
    const desiredIds = new Set(links.map((row) => row.unit_id));
    const removedIds = [...existingIds].filter((unitId) => !desiredIds.has(unitId));

    if (removedIds.length > 0) {
      const { error } = await supabase.from('product_unit_links').delete().eq('product_id', product_id).in('unit_id', removedIds);
      if (error) throw error;
    }

    for (const row of links) {
      if (existingIds.has(row.unit_id)) {
        const { error } = await supabase
          .from('product_unit_links')
          .update({ quantity: row.quantity })
          .eq('product_id', product_id)
          .eq('unit_id', row.unit_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('product_unit_links').insert({ product_id, unit_id: row.unit_id, quantity: row.quantity });
        if (error) throw error;
      }
    }
  },

  // ─── Production ───────────────────────────────────────────
  async produceInventoryUnit(p_unit_id: string, p_quantity: number, p_warehouse_id: string, p_notes?: string) {
    const { data, error } = await supabase.rpc('produce_inventory_unit', {
      p_unit_id, p_quantity, p_warehouse_id, p_notes: p_notes ?? null,
    });
    if (error) throw error;
    return data;
  },

  // ─── Kitchen ──────────────────────────────────────────────
  async listKitchenStations() {
    const { data, error } = await supabase.from('kitchen_stations').select('*').order('sort_order');
    if (error) throw error;
    return data;
  },

  async createKitchenStation(station: { code: string; name_ar: string; name_en: string; sort_order?: number }) {
    const { data, error } = await supabase.from('kitchen_stations').insert(station).select().single();
    if (error) throw error;
    return data;
  },

  async updateKitchenStation(id: string, updates: { name_ar?: string; name_en?: string; is_active?: boolean; sort_order?: number }) {
    const { data, error } = await supabase.from('kitchen_stations').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteKitchenStation(id: string) {
    const { error } = await supabase.from('kitchen_stations').delete().eq('id', id);
    if (error) throw error;
  },

  async setKitchenStatus(p_order_id: string, p_status: string) {
    const { error } = await supabase.rpc('set_kitchen_status', { p_order_id, p_status });
    if (error) throw error;
  },
};
