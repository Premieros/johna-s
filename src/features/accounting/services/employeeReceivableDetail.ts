import { supabase } from '@/api';
import type { ArAgingRow } from '@/lib/types';

export type EmployeeCustomerSnapshot = {
  id: string;
  name: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  branch_id: string;
};

export type PartyStatementRowSnapshot = {
  line_id: string;
  entry_date: string;
  entry_number: string | null;
  reference_type: string | null;
  reference_number: string | null;
  description: string | null;
  debit: number | string;
  credit: number | string;
};

export type EmployeeReceivableSnapshot = {
  customer: EmployeeCustomerSnapshot;
  agingRows: ArAgingRow[];
  journalRows: PartyStatementRowSnapshot[];
};

export async function fetchEmployeeReceivableSnapshot(params: {
  customerId: string;
  openingDate: string;
}): Promise<EmployeeReceivableSnapshot> {
  const customerRes = await supabase
    .from('customers')
    .select('id,name,name_en,phone,email,branch_id,customer_type')
    .eq('id', params.customerId)
    .eq('customer_type', 'employee')
    .maybeSingle();

  if (customerRes.error) throw customerRes.error;
  if (!customerRes.data) throw new Error('EMPLOYEE_NOT_FOUND');

  const customer = customerRes.data as EmployeeCustomerSnapshot;
  const today = new Date().toISOString().slice(0, 10);

  const [balancesRes, statementRes] = await Promise.all([
    supabase.rpc('get_employee_receivable_balances', {
      p_branch_id: customer.branch_id,
      p_as_of: today,
    }),
    supabase.rpc('get_party_statement', {
      p_branch_id: customer.branch_id,
      p_side: 'ar',
      p_party_id: customer.id,
      p_from_date: params.openingDate,
      p_to_date: null,
    }),
  ]);

  if (balancesRes.error) throw balancesRes.error;
  if (statementRes.error) throw statementRes.error;

  const statement = (statementRes.data || {}) as { rows?: PartyStatementRowSnapshot[] };

  return {
    customer,
    agingRows: (balancesRes.data || []) as ArAgingRow[],
    journalRows: statement.rows || [],
  };
}
