import { supabase } from '@/api';
import type { ArAgingRow } from '@/lib/types';

export type EmployeeCustomer = {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  branch_id: string;
  customer_type: 'employee';
};

export type EmployeeReceivableRow = EmployeeCustomer & {
  open_amount: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
};

export type EmployeePaymentResult = {
  success?: boolean;
  error?: string;
  detail?: string;
};

export async function loadEmployeeReceivableRows(branchId: string): Promise<EmployeeReceivableRow[]> {
  const [customersResult, agingResult] = await Promise.all([
    supabase
      .from('customers')
      .select('id,name,name_en,phone,email,address,notes,branch_id,customer_type')
      .eq('branch_id', branchId)
      .eq('customer_type', 'employee')
      .order('name'),
    supabase.rpc('get_employee_receivable_balances', {
      p_branch_id: branchId,
      p_as_of: new Date().toISOString().slice(0, 10),
    }),
  ]);

  if (customersResult.error) throw customersResult.error;
  if (agingResult.error) throw agingResult.error;

  const agingRows = (agingResult.data || []) as ArAgingRow[];
  const agingByCustomer = new Map(agingRows.map((row) => [row.customer_id, row]));

  return ((customersResult.data || []) as EmployeeCustomer[]).map((customer) => {
    const aging = agingByCustomer.get(customer.id);
    return {
      ...customer,
      open_amount: Number(aging?.open_amount || 0),
      bucket_0_30: Number(aging?.bucket_0_30 || 0),
      bucket_31_60: Number(aging?.bucket_31_60 || 0),
      bucket_61_90: Number(aging?.bucket_61_90 || 0),
      bucket_90_plus: Number(aging?.bucket_90_plus || 0),
    };
  });
}

export async function createEmployeeCustomer(payload: {
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  branch_id: string;
  customer_type: 'employee';
  employee_user_id: null;
}): Promise<void> {
  const { error } = await supabase.from('customers').insert(payload);
  if (error) throw error;
}

export async function receiveEmployeeReceivablePayment(params: {
  customerId: string;
  branchId: string;
  amount: number;
  paymentMethod: string;
  notes: string | null;
}): Promise<EmployeePaymentResult> {
  const { data, error } = await supabase.rpc('receive_employee_receivable_payment', {
    p_customer_id: params.customerId,
    p_branch_id: params.branchId,
    p_amount: params.amount,
    p_payment_method: params.paymentMethod,
    p_notes: params.notes,
  });
  if (error) throw error;
  return (data || {}) as EmployeePaymentResult;
}
