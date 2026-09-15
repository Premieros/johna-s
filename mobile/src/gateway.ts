import { supabase } from './supabase';
import {
  MOBILE_ACTION_PERMISSIONS,
  type BranchPosConfig,
  type CreateTableOrderInput,
  type DiningTableSummary,
  type MobileBranch,
  type MobileSessionProfile,
  type ModifierGroup,
  type WaiterCartItemInput,
  type WaiterCatalogProduct,
  type WaiterOrderDetails,
  type WaiterOrderSummary,
} from './contracts';

type RpcResult = { success?: boolean; error?: string; detail?: string; order_id?: string; order_number?: string; items_sent_count?: number };
type UserRow = { id: string; full_name?: string | null; username?: string | null; email?: string | null; role?: string | null; branch_id?: string | null; is_active?: boolean | null };

const requireSuccess = (data: unknown, fallback: string): RpcResult => {
  const result = (data || {}) as RpcResult;
  if (!result.success) throw new Error(result.detail || result.error || fallback);
  return result;
};

const currentUserId = async () => {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error('SESSION_REQUIRED');
  return id;
};

export async function signIn(username: string, pin: string): Promise<void> {
  const normalized = username.trim().toLowerCase();
  if (!normalized || !pin) throw new Error('USERNAME_AND_PIN_REQUIRED');
  let email = normalized.includes('@') ? normalized : `${normalized}@premier.sa`;
  const lookup = await supabase.rpc('get_login_email', { p_username: normalized });
  if (!lookup.error) {
    const row = (lookup.data || {}) as { success?: boolean; email?: string | null };
    if (row.success && row.email) email = row.email;
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
  if (error) throw error;
  const userId = await currentUserId();
  const { data: profile, error: profileError } = await supabase.from('users').select('id,is_active').eq('id', userId).maybeSingle();
  if (profileError || !profile || profile.is_active === false) {
    await supabase.auth.signOut();
    throw new Error('APPLICATION_PROFILE_REQUIRED');
  }
}

export async function signOut(): Promise<void> { await supabase.auth.signOut(); }
export async function hasSession(): Promise<boolean> { const { data } = await supabase.auth.getSession(); return Boolean(data.session?.user?.id); }

export async function getSessionProfile(): Promise<MobileSessionProfile> {
  const userId = await currentUserId();
  const { data, error } = await supabase.from('users').select('id,full_name,username,email,role,branch_id,is_active').eq('id', userId).maybeSingle();
  if (error || !data || data.is_active === false) throw error || new Error('PROFILE_NOT_FOUND');
  const user = data as UserRow;

  let isSuperAdmin = false;
  const superAdmin = await supabase.rpc('is_super_admin');
  if (!superAdmin.error) isSuperAdmin = superAdmin.data === true;

  const permissions = new Set<string>();
  if (isSuperAdmin) {
    for (const permission of MOBILE_ACTION_PERMISSIONS) permissions.add(permission);
    const { data: roleRows } = await supabase.from('roles').select('permissions').eq('is_active', true);
    for (const row of (roleRows || []) as { permissions?: unknown }[]) {
      if (Array.isArray(row.permissions)) for (const permission of row.permissions) if (typeof permission === 'string') permissions.add(permission);
    }
  } else if (user.role) {
    const { data: roleRows } = await supabase.from('roles').select('permissions').eq('role', user.role).eq('is_active', true);
    for (const row of (roleRows || []) as { permissions?: unknown }[]) {
      if (Array.isArray(row.permissions)) for (const permission of row.permissions) if (typeof permission === 'string') permissions.add(permission);
    }
  }

  const branchIds = new Set<string>();
  if (user.branch_id) branchIds.add(user.branch_id);
  const { data: accessRows } = await supabase.from('user_branch_access').select('branch_id').eq('user_id', userId);
  for (const row of (accessRows || []) as { branch_id?: string | null }[]) if (row.branch_id) branchIds.add(row.branch_id);
  if (isSuperAdmin) {
    const { data: allBranches } = await supabase.from('branches').select('id').eq('is_active', true);
    for (const row of (allBranches || []) as { id: string }[]) branchIds.add(row.id);
  }

  return {
    userId,
    displayName: user.full_name || user.username || user.email || 'مستخدم',
    username: user.username || user.email || '',
    role: user.role || '',
    primaryBranchId: user.branch_id || null,
    branchIds: [...branchIds],
    permissions: [...permissions].sort(),
    isSuperAdmin,
  };
}

export async function getBranches(): Promise<MobileBranch[]> {
  const { data, error } = await supabase.from('branches').select('id,name,name_en').eq('is_active', true).order('name');
  if (error) throw error;
  return ((data || []) as { id: string; name: string; name_en?: string | null }[]).map((row) => ({ id: row.id, name: row.name, nameEn: row.name_en }));
}

export async function getBranchPosConfig(branchId: string): Promise<BranchPosConfig> {
  const { data: branch } = await supabase.from('branch_settings').select('tax_enabled,tax_rate,currency').eq('branch_id', branchId).maybeSingle();
  if (branch) return { taxEnabled: Boolean(branch.tax_enabled), taxRate: Number(branch.tax_rate || 0), currency: String(branch.currency || 'EGP') };
  const { data: global } = await supabase.from('settings').select('tax_enabled,tax_rate,currency').maybeSingle();
  return { taxEnabled: Boolean(global?.tax_enabled), taxRate: Number(global?.tax_rate || 0), currency: String(global?.currency || 'EGP') };
}

export async function getDiningTables(branchId: string): Promise<DiningTableSummary[]> {
  const { data: tableRows, error } = await supabase.from('dining_tables').select('id,branch_id,area_id,name,status,capacity,area:dining_areas(name)').eq('branch_id', branchId).order('name');
  if (error) throw error;
  const { data: orderRows } = await supabase.from('orders').select('id,order_number,table_id,guest_count,cashier_id,status').eq('branch_id', branchId).in('status', ['open', 'held']).not('table_id', 'is', null);
  const activeOrders = (orderRows || []) as { id: string; order_number: string; table_id: string | null; guest_count?: number | null; cashier_id?: string | null; status: string }[];
  const cashierIds = [...new Set(activeOrders.map((row) => row.cashier_id).filter((id): id is string => Boolean(id)))];
  const userNames = new Map<string, string>();
  if (cashierIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id,full_name,username').in('id', cashierIds);
    for (const row of (users || []) as { id: string; full_name?: string | null; username?: string | null }[]) userNames.set(row.id, row.full_name || row.username || 'مستخدم');
  }
  const orderByTable = new Map(activeOrders.filter((row) => row.table_id).map((row) => [row.table_id as string, row]));
  return ((tableRows || []) as Array<{ id: string; branch_id: string; area_id?: string | null; name: string; status?: string | null; capacity?: number | null; area?: { name?: string | null } | { name?: string | null }[] | null }>).map((row) => {
    const order = orderByTable.get(row.id);
    const area = Array.isArray(row.area) ? row.area[0] : row.area;
    return {
      id: row.id, branchId: row.branch_id, areaId: row.area_id, areaName: area?.name || null, name: row.name,
      status: order || row.status === 'occupied' ? 'occupied' : 'available', guestCount: order?.guest_count || null,
      capacity: row.capacity || null, activeOrderId: order?.id || null, activeOrderNumber: order?.order_number || null,
      activeWaiterName: order?.cashier_id ? userNames.get(order.cashier_id) || null : null,
    };
  });
}

export async function getCatalog(branchId: string): Promise<WaiterCatalogProduct[]> {
  const { data, error } = await supabase.from('products').select('id,branch_id,category_id,name,name_en,description,image_url,sale_price,is_active,category:categories(name)').eq('branch_id', branchId).eq('is_active', true).order('name');
  if (error) throw error;
  return ((data || []) as Array<{ id: string; branch_id: string; category_id?: string | null; name: string; name_en?: string | null; description?: string | null; image_url?: string | null; sale_price?: number | string | null; is_active?: boolean | null; category?: { name?: string | null } | { name?: string | null }[] | null }>).map((row) => {
    const category = Array.isArray(row.category) ? row.category[0] : row.category;
    return { id: row.id, branchId: row.branch_id, categoryId: row.category_id || null, categoryName: category?.name || null, name: row.name, nameEn: row.name_en, description: row.description, imageUrl: row.image_url, salePrice: Number(row.sale_price || 0), isActive: row.is_active !== false };
  });
}

export async function getProductModifiers(productId: string): Promise<ModifierGroup[]> {
  const { data, error } = await supabase.rpc('get_product_modifiers', { p_product_id: productId });
  if (error) throw error;
  const result = (data || {}) as { success?: boolean; error?: string; groups?: Array<{ id: string; name: string; name_en?: string | null; min_selections?: number | string | null; max_selections?: number | string | null; options?: Array<{ id: string; name: string; name_en?: string | null; price_delta?: number | string | null; is_default?: boolean | null }> }> };
  if (!result.success) throw new Error(result.error || 'MODIFIERS_LOAD_FAILED');
  return (result.groups || []).map((group) => ({
    id: group.id, name: group.name, nameEn: group.name_en, minSelections: Number(group.min_selections || 0), maxSelections: Math.max(1, Number(group.max_selections || 1)),
    options: (group.options || []).map((option) => ({ id: option.id, name: option.name, nameEn: option.name_en, priceDelta: Number(option.price_delta || 0), isDefault: Boolean(option.is_default) })),
  }));
}

const totalsFor = (items: WaiterCartItemInput[], taxEnabled: boolean, taxRate: number) => {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const taxAmount = taxEnabled ? subtotal * (taxRate / 100) : 0;
  return { subtotal, taxAmount, total: subtotal + taxAmount };
};
const rpcItems = (items: WaiterCartItemInput[]) => items.map((item) => ({ product_id: item.productId, unit_name: 'piece', quantity: item.quantity, unit_price: item.unitPrice, discount_amount: 0, bonus_quantity: 0, total: item.unitPrice * item.quantity, notes: item.notes || null, modifier_option_ids: item.modifierOptionIds }));

export async function createTableOrder(input: CreateTableOrderInput): Promise<{ orderId: string; orderNumber: string }> {
  const userId = await currentUserId();
  const totals = totalsFor(input.items, input.taxEnabled, input.taxRate);
  const { data, error } = await supabase.rpc('create_order', { p_branch_id: input.branchId, p_order_type: 'dine_in', p_table_id: input.tableId, p_customer_id: null, p_guest_count: input.guestCount, p_notes: input.notes || null, p_items: rpcItems(input.items), p_subtotal: totals.subtotal, p_discount_amount: 0, p_discount_type: 'amount', p_tax_amount: totals.taxAmount, p_total: totals.total, p_cashier_id: userId });
  if (error) throw error;
  const result = requireSuccess(data, 'ORDER_CREATE_FAILED');
  if (!result.order_id) throw new Error('ORDER_ID_MISSING');
  return { orderId: result.order_id, orderNumber: result.order_number || result.order_id.slice(0, 8) };
}

export async function updateTableOrder(orderId: string, items: WaiterCartItemInput[], config: BranchPosConfig): Promise<void> {
  const { data: order, error: orderError } = await supabase.from('orders').select('order_type,table_id,customer_id,guest_count,notes,discount_amount,discount_type').eq('id', orderId).maybeSingle();
  if (orderError || !order) throw orderError || new Error('ORDER_NOT_FOUND');
  const totals = totalsFor(items, config.taxEnabled, config.taxRate);
  const discountAmount = Number(order.discount_amount || 0);
  const totalAfterDiscount = Math.max(0, totals.subtotal - discountAmount);
  const taxAmount = config.taxEnabled ? totalAfterDiscount * (config.taxRate / 100) : 0;
  const { data, error } = await supabase.rpc('update_order', { p_order_id: orderId, p_order_type: order.order_type || 'dine_in', p_table_id: order.table_id, p_customer_id: order.customer_id || null, p_guest_count: order.guest_count || null, p_notes: order.notes || null, p_items: rpcItems(items), p_subtotal: totals.subtotal, p_discount_amount: discountAmount, p_discount_type: order.discount_type || 'amount', p_tax_amount: taxAmount, p_total: totalAfterDiscount + taxAmount, p_status: 'open' });
  if (error) throw error;
  requireSuccess(data, 'ORDER_UPDATE_FAILED');
}

export async function sendToKitchen(orderId: string): Promise<number> {
  const { data, error } = await supabase.rpc('send_to_kitchen', { p_order_id: orderId, p_sent_by: null });
  if (error) throw error;
  const result = requireSuccess(data, 'KITCHEN_SEND_FAILED');
  return Number(result.items_sent_count || 0);
}

export async function getMyOrders(branchId?: string): Promise<WaiterOrderSummary[]> {
  const userId = await currentUserId();
  let query = supabase.from('orders').select('id,order_number,branch_id,table_id,total,status,kitchen_status,kitchen_sent_at,cashier_id,table:dining_tables(name)').eq('cashier_id', userId).order('created_at', { ascending: false }).limit(50);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  const profile = await getSessionProfile();
  return ((data || []) as Array<{ id: string; order_number: string; branch_id: string; table_id?: string | null; total?: number | string | null; status: string; kitchen_status?: string | null; kitchen_sent_at?: string | null; table?: { name?: string | null } | { name?: string | null }[] | null }>).map((row) => {
    const table = Array.isArray(row.table) ? row.table[0] : row.table;
    return { orderId: row.id, orderNumber: row.order_number, branchId: row.branch_id, tableId: row.table_id || null, tableName: table?.name || '—', waiterName: profile.displayName, total: Number(row.total || 0), status: row.status, kitchenStatus: row.kitchen_status, sentToKitchenAt: row.kitchen_sent_at };
  });
}

export async function getOrderDetails(orderId: string): Promise<WaiterOrderDetails> {
  const { data: order, error: orderError } = await supabase.from('orders').select('id,order_number,branch_id,table_id,total,status,kitchen_status,kitchen_sent_at,guest_count,notes,cashier_id,table:dining_tables(name)').eq('id', orderId).maybeSingle();
  if (orderError || !order) throw orderError || new Error('ORDER_NOT_FOUND');
  const { data: itemRows, error: itemError } = await supabase.from('order_items').select('product_id,quantity,unit_price,modifier_option_ids,notes,product:products(name)').eq('order_id', orderId);
  if (itemError) throw itemError;
  const { data: waiter } = order.cashier_id ? await supabase.from('users').select('full_name,username').eq('id', order.cashier_id).maybeSingle() : { data: null };
  const table = Array.isArray(order.table) ? order.table[0] : order.table;
  return {
    orderId: order.id, orderNumber: order.order_number, branchId: order.branch_id, tableId: order.table_id || null, tableName: table?.name || '—',
    waiterName: waiter?.full_name || waiter?.username || '—', total: Number(order.total || 0), status: order.status, kitchenStatus: order.kitchen_status,
    sentToKitchenAt: order.kitchen_sent_at, guestCount: order.guest_count || null, notes: order.notes || null,
    items: ((itemRows || []) as Array<{ product_id: string; quantity?: number | string | null; unit_price?: number | string | null; modifier_option_ids?: string[] | null; notes?: string | null; product?: { name?: string | null } | { name?: string | null }[] | null }>).map((row) => {
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      return { productId: row.product_id, name: product?.name || 'صنف', unitPrice: Number(row.unit_price || 0), quantity: Number(row.quantity || 0), modifierOptionIds: Array.isArray(row.modifier_option_ids) ? row.modifier_option_ids : [], notes: row.notes || undefined };
    }),
  };
}
