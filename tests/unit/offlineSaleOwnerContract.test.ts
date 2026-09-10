import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('offline sale originating-user contract', () => {
  it('persists the authenticated creator before accepting an offline financial action', () => {
    const payment = read('src/features/pos/services/payment.ts');

    expect(payment).toContain('await supabase.auth.getSession()');
    expect(payment).toContain('created_by_user_id: originatingUserId');
    expect(payment).toContain("throw new Error('AUTH_REQUIRED_OFFLINE')");

    const identity = payment.indexOf('created_by_user_id: originatingUserId');
    const enqueue = payment.indexOf('await enqueueOfflineSale(queuedSale)');
    expect(identity).toBeGreaterThanOrEqual(0);
    expect(enqueue).toBeGreaterThan(identity);
  });

  it('blocks cross-user replay before process_sale or reconciliation can run', () => {
    const sync = read('src/core/offline/syncEngine.ts');

    expect(sync).toContain('created_by_user_id?: string');
    expect(sync).toContain("'OFFLINE_SALE_OWNER_MISMATCH'");
    expect(sync).toContain("'OFFLINE_SALE_OWNER_MISSING'");
    expect(sync).toContain("'AUTH_REQUIRED_OFFLINE_SYNC'");

    const ownerGuard = sync.indexOf('originatingUserId !== currentUserId');
    const processSale = sync.indexOf('await posApi.processSale(');
    const reconcile = sync.indexOf('await this.reconcileCommittedSale(item)');
    expect(ownerGuard).toBeGreaterThanOrEqual(0);
    expect(processSale).toBeGreaterThan(ownerGuard);
    expect(reconcile).toBeGreaterThan(ownerGuard);
  });

  it('resolves an authoritative warehouse before replay and fails closed when none exists', () => {
    const sync = read('src/core/offline/syncEngine.ts');

    expect(sync).toContain('private async resolveReplayWarehouse');
    expect(sync).toContain(".select('inventory_warehouse_id')");
    expect(sync).toContain(".from('warehouses')");
    expect(sync).toContain(".order('is_default', { ascending: false })");
    expect(sync).toContain("throw new Error('WAREHOUSE_REQUIRED_OFFLINE_SYNC')");
    expect(sync).toContain('p_warehouse_id: warehouseId');

    const resolveWarehouse = sync.indexOf('const warehouseId = await this.resolveReplayWarehouse(item)');
    const processSale = sync.indexOf('await posApi.processSale(replayPayload)');
    expect(resolveWarehouse).toBeGreaterThanOrEqual(0);
    expect(processSale).toBeGreaterThan(resolveWarehouse);
  });

  it('enforces the same owner identity at the database reconciliation boundary', () => {
    const migration = read('supabase/migrations/20260910008000_offline_sale_owner_reconciliation.sql');

    expect(migration).toContain('v_sale.cashier_id IS DISTINCT FROM auth.uid()');
    expect(migration).toContain("'OFFLINE_SALE_OWNER_MISMATCH'");
    expect(migration).toContain("public.can_permission('pos.payment.take')");
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
  });
});
