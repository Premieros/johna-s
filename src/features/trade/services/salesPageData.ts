import { supabase } from '@/api';
import type { BranchSettings, Customer, Settings } from '@/lib/types';

export async function loadSalesCustomers(branchId: string): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('branch_id', branchId)
    .order('name');
  if (error) throw error;
  return (data as Customer[]) || [];
}

export async function loadSalePaymentRows(saleId: string): Promise<Array<{
  payment_method: string | null;
  amount: number | null;
  refunded_amount: number | null;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from('sale_payments')
    .select('payment_method, amount, refunded_amount, created_at')
    .eq('sale_id', saleId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as Array<{
    payment_method: string | null;
    amount: number | null;
    refunded_amount: number | null;
    created_at: string;
  }>;
}

export async function loadReceiptSettingsRows(branchId: string): Promise<{
  globalSettings: Settings | null;
  branchSettings: BranchSettings | null;
}> {
  const [globalResult, branchResult] = await Promise.all([
    supabase.from('settings').select('*').maybeSingle(),
    supabase.from('branch_settings').select('*').eq('branch_id', branchId).maybeSingle(),
  ]);
  if (globalResult.error) throw new Error(`SETTINGS_LOAD_FAILED: ${globalResult.error.message}`);
  if (branchResult.error) throw new Error(`BRANCH_SETTINGS_LOAD_FAILED: ${branchResult.error.message}`);

  return {
    globalSettings: (globalResult.data as Settings | null) || null,
    branchSettings: (branchResult.data as BranchSettings | null) || null,
  };
}

export async function requestSaleManagerApproval(params: {
  actionType: string;
  saleId: string;
  payload: Record<string, unknown>;
  reason: string;
}): Promise<{ success?: boolean; error?: string; request_id?: string }> {
  const { data, error } = await supabase.rpc('request_manager_approval', {
    p_action_type: params.actionType,
    p_entity_type: 'sale',
    p_entity_id: params.saleId,
    p_payload: params.payload,
    p_reason: params.reason,
  });
  if (error) throw error;
  return (data || {}) as { success?: boolean; error?: string; request_id?: string };
}

export async function changeSalePaymentMethod(params: {
  saleId: string;
  newMethod: string;
}): Promise<{ success?: boolean; error?: string; detail?: string }> {
  const { data, error } = await supabase.rpc('change_sale_payment_method', {
    p_sale_id: params.saleId,
    p_new_method: params.newMethod,
    p_reason: null,
  });
  if (error) throw error;
  return (data || {}) as { success?: boolean; error?: string; detail?: string };
}

export async function updateSaleMetadata(params: {
  saleId: string;
  customerId: string | null;
  status: string;
  notes: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('sales')
    .update({
      customer_id: params.customerId,
      status: params.status,
      notes: params.notes,
    })
    .eq('id', params.saleId);
  if (error) throw error;
}
