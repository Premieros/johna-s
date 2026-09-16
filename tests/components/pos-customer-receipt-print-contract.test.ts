import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, 'src/features/pos/pages/PosWorkspacePage.tsx'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/features/pos/components/order/PosOrderHeaderBar.tsx'), 'utf8');
const printing = fs.readFileSync(path.join(root, 'src/features/pos/utils/printing.ts'), 'utf8');

describe('POS customer receipt print contract', () => {
  it('routes sale-screen print actions to the customer receipt, not the kitchen ticket', () => {
    expect(workspace).not.toContain('onPrint={pos.printKitchenTicket}');
    expect(workspace).toContain('onPrint={() => void pos.printReceipt()}');
    expect(workspace).toContain('perms.canPrint && pos.lastReceipt && pos.cart.length === 0');
  });

  it('gates the visible print action with pos.receipt.print', () => {
    expect(header).toContain('perms.canPrint && canPrintReceipt');
    expect(header).not.toContain('perms.canPrintKitchen && itemsCount > 0');
    expect(workspace).toContain('data-testid="pos-receipt-print"');
    expect(workspace).toContain('{perms.canPrint && (');
  });

  it('keeps the existing single-print and manager-approved reprint authorization', () => {
    expect(printing).toContain("supabase.rpc('authorize_sale_print'");
    expect(printing).toContain("initial.error !== 'MANAGER_APPROVAL_REQUIRED'");
    expect(printing).toContain("p_action_type: 'reprint'");
    expect(printing).toContain("supabase.rpc('record_sale_print'");
  });
});
