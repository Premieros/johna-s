export type ShiftPaymentMethod = {
  method: string;
  label: string;
  count: number;
  total: number;
};

export type ShiftOperationLike = {
  operation_type: string;
  amount: number;
  payment_method?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
};

const RECEIVABLE_METHODS = new Set(['credit', 'employee_credit']);

const money = (value: number) => Number(Number(value || 0).toFixed(2));

export function isReceivablePaymentMethod(method: string): boolean {
  return RECEIVABLE_METHODS.has(String(method || '').toLowerCase());
}

export function summarizeShiftPayments(paymentMethods: ShiftPaymentMethod[]) {
  const collected = paymentMethods.filter((row) => !isReceivablePaymentMethod(row.method));
  const receivables = paymentMethods.filter((row) => isReceivablePaymentMethod(row.method));

  return {
    collected,
    receivables,
    collectedTotal: money(collected.reduce((sum, row) => sum + Number(row.total || 0), 0)),
    receivableTotal: money(receivables.reduce((sum, row) => sum + Number(row.total || 0), 0)),
  };
}

export function averageShiftTicket(netSales: number, invoiceCount: number): number {
  const count = Number(invoiceCount || 0);
  if (count <= 0) return 0;
  return Number(netSales || 0) / count;
}

export function isDrawerExpenseOperation(operation: ShiftOperationLike): boolean {
  const paymentMethod = String(operation.payment_method || 'cash').toLowerCase();
  if (paymentMethod !== 'cash') return false;

  return operation.operation_type === 'expense'
    || (operation.operation_type === 'cash_out' && operation.reference_type === 'expense');
}

export function summarizeExpenseSources(
  totalExpenses: number,
  operations: ShiftOperationLike[],
  explicitDrawerExpenses?: number,
) {
  const drawerOperations = operations.filter(isDrawerExpenseOperation);
  const computedDrawerExpenses = drawerOperations.reduce(
    (sum, operation) => sum + Number(operation.amount || 0),
    0,
  );
  const drawerExpenses = money(
    explicitDrawerExpenses === undefined ? computedDrawerExpenses : explicitDrawerExpenses,
  );
  const total = money(totalExpenses);

  return {
    drawerExpenses,
    nonDrawerExpenses: money(Math.max(0, total - drawerExpenses)),
    drawerExpenseIds: Array.from(new Set(
      drawerOperations
        .map((operation) => operation.reference_id)
        .filter((id): id is string => Boolean(id)),
    )),
  };
}
