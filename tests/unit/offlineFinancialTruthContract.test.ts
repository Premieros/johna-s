import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('offline financial truth contract', () => {
  it('treats explicit offline checkout as pending sync, never server-confirmed payment', () => {
    const payment = read('src/features/pos/services/payment.ts');
    const hook = read('src/features/pos/hooks/usePosOrder.ts');

    expect(payment).toContain('pending_sync?: boolean');
    expect(payment).toContain('const queuedId = await queueOfflineSale(p)');
    expect(payment).toContain('offline: true');
    expect(payment).toContain('pending_sync: true');
    expect(payment).toContain('await enqueueOfflineSale({');

    expect(hook).toContain("const explicitlyOffline = typeof navigator !== 'undefined' && !navigator.onLine");
    expect(hook).toContain('if (!explicitlyOffline) return base.completeSale()');
    expect(hook).toContain('!result.offline || !result.pending_sync');
    expect(hook).toContain('لم يتم تسجيل البيع أو الدفع نهائيًا بعد');
    expect(hook).toContain('The sale/payment is not final until the server confirms it.');
    expect(hook).not.toContain("from '../services/localPrintAgent'");
    expect(hook).not.toContain('executeCashDrawerKick(');
  });

  it('keeps an outbox item until the server success is durable or reconciliation confirms it', () => {
    const sync = read('src/core/offline/syncEngine.ts');

    expect(sync).toContain('let confirmed = !error && res?.success === true && Boolean(res.sale_id)');
    expect(sync).toContain('const reconciled = await this.reconcileCommittedSale(item)');
    expect(sync).toContain('confirmed = Boolean(reconciled?.success && reconciled.sale_id)');
    expect(sync).toContain("throw new Error(message)");
    expect(sync).toContain("await updateOfflineSaleStatus(item.id, 'failed', errorMsg)");

    const confirmGuard = sync.indexOf('if (!confirmed)');
    const remove = sync.indexOf('await removeOfflineSale(item.id)');
    expect(confirmGuard).toBeGreaterThanOrEqual(0);
    expect(remove).toBeGreaterThan(confirmGuard);
  });

  it('uses one durable IndexedDB queue and includes the branch cache required by OfflineContext', () => {
    const storage = read('src/core/offline/offlineStorage.ts');

    expect(storage).toContain('const DB_VERSION = 3');
    expect(storage).toContain("db.createObjectStore('branches', { keyPath: 'id' })");
    expect(storage).toContain("db.createObjectStore('sales_queue', { keyPath: 'id' })");
    expect(storage).toContain("status: 'pending'");
    expect(storage).toContain("items.filter((i) => i.status !== 'synced').length");
  });

  it('enforces branch/invoice idempotency and permission-first reconciliation in the database contract', () => {
    const migration = read('supabase/migrations/20260910004000_offline_sale_reconciliation.sql');

    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS sales_branch_invoice_unique');
    expect(migration).toContain('ON public.sales (branch_id, invoice_number)');
    expect(migration).toContain("public.can_permission('pos.payment.take')");
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
    expect(migration).toContain("p_invoice_number NOT LIKE 'INV-OFF-%'");
    expect(migration).toContain("'OFFLINE_RECONCILIATION_CONFLICT'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) FROM anon');
  });
});
