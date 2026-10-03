import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const orders = readFileSync('src/features/pos/services/posOrders.ts', 'utf8');
const panel = readFileSync('src/features/pos/components/order/CurrentOrderPanel.tsx', 'utf8');

describe('POS resumed-order hydration performance contract', () => {
  it('keeps authorization as the first gate for opening another active order', () => {
    const fn = orders.slice(orders.indexOf('export async function fetchOrderForWorkspace'));
    const authIndex = fn.indexOf("supabase.rpc('authorize_pos_order_access'");
    const orderIndex = fn.indexOf(".from('orders')");
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(orderIndex).toBeGreaterThan(authIndex);
  });

  it('hydrates order, items and products in one post-authorization query', () => {
    const fn = orders.slice(orders.indexOf('export async function fetchOrderForWorkspace'));
    expect(fn).toContain("order_items!order_items_order_id_fkey(*, product:products!order_items_product_id_fkey(*))");
    expect(fn).not.toContain(".from('order_items').select('*')");
    expect(fn).not.toContain(".from('products').select('*').in('id', ids)");
  });

  it('shows a resume skeleton instead of an empty-cart message while an existing order is loading', () => {
    expect(panel).toContain('data-testid="pos-resume-order-loading"');
    expect(panel).toContain("orderLoading && activeOrderId && empty");
    expect(panel).toContain('جارٍ استرجاع أصناف الطلب…');
    expect(panel).toContain('Restoring order items…');
  });
});
