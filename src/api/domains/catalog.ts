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
export type DirectRawComponentInput = { raw_material_id: string; quantity: number; wastage_percent?: number };
export type ProductDirectRawComposition = {
  recipe_id: string | null;
  yield_quantity: number;
  items: DirectRawComponentInput[];
};
export type KitchenOrderContextRow = { order_id: string; table_name: string | null; operator_name: string | null };
export type KitchenHistoryRow = { order_id: string; order_number: string; kitchen_status: string; updated_at: string; kitchen_sent_at: string | null; table_name: string | null };
export type KitchenHistoryPage = { rows: KitchenHistoryRow[]; count: number };

export const catalog = {
  replaceProductUnits(p: { p_product_id: string; p_units: unknown }): ApiResult<null> { return rpc('replace_product_units', p); },
  createRawMaterial(p: CreateRawMaterialInput): ApiResult<CreateRawMaterialResult> { return rpc('create_raw_material', p); },
  createProduct(p: CreateProductInput): ApiResult<CreateProductResult> { return rpc('create_product', p); },
  getKitchenOrderContext(p: { p_order_ids: string[]; p_branch_id: string }): ApiResult<KitchenOrderContextRow[]> { return rpc('get_kitchen_order_context', p); },
  getKitchenCompletedHistory(p: { p_branch_id: string; p_from_ts: string; p_to_ts: string; p_station: string | null; p_page: number }): ApiResult<KitchenHistoryPage> { return rpc('get_kitchen_completed_history', p); },
  finishEmptyKitchenOrder(p: { p_order_id: string; p_branch_id: string }): ApiResult<{ success: boolean; changed: boolean }> { return rpc('finish_empty_kitchen_order', p); },
  getProductModifiers(p_product_id: string): ApiResult<unknown> { return rpc('get_product_modifiers', { p_product_id }); },
  getProductModifiersAdmin(p_product_id: string) {
    return supabase.rpc('get_product_modifiers_admin', { p_product_id });
  },
  saveProductModifiers(p_product_id: string, p_groups: unknown): ApiResult<unknown> { return rpc('save_product_modifiers', { p_product_id, p_groups }); },
  listModifierGroupsAdmin(p_branch_id: string) {
    return supabase.rpc('list_modifier_groups_admin', { p_branch_id });
  },
  saveModifierGroup(p: { p_group_id?: string | null; p_branch_id: string; p_group: unknown; p_product_ids: string[] }) {
    return supabase.rpc('save_modifier_group', {
      p_group_id: p.p_group_id ?? null,
      p_branch_id: p.p_branch_id,
      p_group: p.p_group,
      p_product_ids: p.p_product_ids,
    });
  },
  archiveModifierGroup(p_group_id: string) {
    return supabase.rpc('archive_modifier_group', { p_group_id });
  },

  async listInventoryUnits(filters?: { branch_id?: string; unit_type?: string; is_active?: boolean }) {
    let q = supabase.from('inventory_units').select('*').order('name');
    if (filters?.branch_id) q = q.eq('branch_id', filters.branch_id);
    if (filters?.unit_type) q = q.eq('unit_type', filters.unit_type);
    if (filters?.is_active !== undefined) q = q.eq('is_active', filters.is_active);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async getProductDirectRawComponents(product_id: string, branch_id: string): Promise<ProductDirectRawComposition> {
    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .select('id,yield_quantity')
      .eq('product_id', product_id)
      .eq('branch_id', branch_id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recipeError) throw recipeError;
    if (!recipe?.id) return { recipe_id: null, yield_quantity: 1, items: [] };

    const { data: items, error: itemsError } = await supabase
      .from('recipe_items')
      .select('raw_material_id,quantity,wastage_percent')
      .eq('recipe_id', recipe.id)
      .order('created_at');
    if (itemsError) throw itemsError;
    return {
      recipe_id: recipe.id,
      yield_quantity: Number(recipe.yield_quantity) || 1,
      items: ((items || []) as DirectRawComponentInput[]).map((row) => ({
        raw_material_id: row.raw_material_id,
        quantity: Number(row.quantity) || 0,
        wastage_percent: Number(row.wastage_percent) || 0,
      })),
    };
  },

  async saveProductDirectRawComponents(p: {
    product_id: string;
    branch_id: string;
    product_name: string;
    items: DirectRawComponentInput[];
  }) {
    const normalized = p.items.map((row) => ({
      raw_material_id: row.raw_material_id,
      quantity: Number(row.quantity),
      wastage_percent: Number(row.wastage_percent || 0),
    }));
    if (normalized.some((row) => !row.raw_material_id || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.wastage_percent < 0)) {
      throw new Error('INVALID_DIRECT_RAW_COMPONENT');
    }
    if (new Set(normalized.map((row) => row.raw_material_id)).size !== normalized.length) {
      throw new Error('DUPLICATE_RAW_MATERIAL');
    }

    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .select('id,name,yield_quantity,notes,is_active')
      .eq('product_id', p.product_id)
      .eq('branch_id', p.branch_id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recipeError) throw recipeError;

    if (normalized.length === 0) {
      if (!recipe?.id) return { success: true, recipe_id: null, items_count: 0 };
      const { data, error } = await supabase.rpc('delete_recipe_controlled', { p_recipe_id: recipe.id });
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string };
      if (!result.success) throw new Error(result.detail || result.error || 'DIRECT_RAW_DELETE_FAILED');
      return { success: true, recipe_id: null, items_count: 0 };
    }

    if (recipe?.id) {
      const { data, error } = await supabase.rpc('update_recipe_with_items', {
        p_recipe_id: recipe.id,
        p_name: recipe.name || p.product_name,
        p_yield_quantity: Number(recipe.yield_quantity) || 1,
        p_notes: recipe.notes || '',
        p_is_active: recipe.is_active !== false,
        p_items: normalized,
      });
      if (error) throw error;
      const result = (data || {}) as { success?: boolean; error?: string; detail?: string; recipe_id?: string; items_count?: number };
      if (!result.success) throw new Error(result.detail || result.error || 'DIRECT_RAW_SAVE_FAILED');
      return result;
    }

    const { data: created, error: createError } = await supabase
      .from('recipes')
      .insert({
        product_id: p.product_id,
        branch_id: p.branch_id,
        name: `${p.product_name} Components`,
        yield_quantity: 1,
        notes: null,
        is_active: true,
      })
      .select('id')
      .single();
    if (createError || !created?.id) throw createError || new Error('DIRECT_RAW_CREATE_FAILED');

    const { error: itemsError } = await supabase.from('recipe_items').insert(
      normalized.map((row) => ({ ...row, recipe_id: created.id })),
    );
    if (itemsError) {
      await supabase.rpc('delete_recipe_controlled', { p_recipe_id: created.id });
      throw itemsError;
    }
    return { success: true, recipe_id: created.id, items_count: normalized.length };
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

  getKitchenStationAssignments(p_branch_id: string) {
    return supabase.rpc('get_kitchen_station_assignments', { p_branch_id });
  },

  getKitchenStationEditorContext(p_branch_id: string) {
    return supabase.rpc('get_kitchen_station_editor_context', { p_branch_id });
  },

  saveKitchenStationAssignments(p: { p_branch_id: string; p_station_id: string; p_user_ids: string[]; p_category_ids: string[] }) {
    return supabase.rpc('save_kitchen_station_assignments', {
      p_branch_id: p.p_branch_id,
      p_station_id: p.p_station_id,
      p_user_ids: p.p_user_ids,
      p_category_ids: p.p_category_ids,
    });
  },

  async setKitchenStatus(p_order_id: string, p_status: string) {
    const { error } = await supabase.rpc('set_kitchen_status', { p_order_id, p_status });
    if (error) throw error;
  },
};
