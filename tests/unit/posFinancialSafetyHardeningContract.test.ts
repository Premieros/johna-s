import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('POS financial safety hardening contract', () => {
  it('locks checkout synchronously before financial awaits in both direct and linked paths', () => {
    const base = read('src/features/pos/hooks/usePosOrderBase.ts');
    const wrapper = read('src/features/pos/hooks/usePosOrder.ts');

    expect(base).toContain('const saleMutationLockRef = useRef(false)');
    expect(base).toContain('if (saleMutationLockRef.current || cart.length === 0 || completing) return false');
    expect(base).toContain('saleMutationLockRef.current = true');
    expect(base).toContain('saleMutationLockRef.current = false');

    expect(wrapper).toContain('const saleMutationLockRef = useRef(false)');
    expect(wrapper).toContain('if (saleMutationLockRef.current || base.cart.length === 0');
    expect(wrapper).toContain('if (saleMutationLockRef.current) return false');
  });

  it('retains a stable client operation identity across ambiguous retries', () => {
    const base = read('src/features/pos/hooks/usePosOrderBase.ts');
    const wrapper = read('src/features/pos/hooks/usePosOrder.ts');
    const payment = read('src/features/pos/services/payment.ts');

    expect(payment).toContain('export function createSaleOperationKey()');
    expect(base).toContain('saleAttemptRef = useRef');
    expect(base).toContain('p_client_operation_key: clientOperationKey');
    expect(base).toContain('result.invoice_number || invoiceNumber');
    expect(wrapper).toContain('saleAttemptRef = useRef');
    expect(wrapper).toContain('p_client_operation_key: saleAttemptRef.current.operationKey');
    expect(wrapper).toContain('extended.invoice_number || invoiceNumber');
  });

  it('keeps retry identity until confirmed sale state is reflected locally', () => {
    const base = read('src/features/pos/hooks/usePosOrderBase.ts');
    const wrapper = read('src/features/pos/hooks/usePosOrder.ts');

    const baseConfirmed = base.indexOf('const confirmedInvoiceNumber = result.invoice_number || invoiceNumber');
    const baseLocalReset = base.indexOf('setGuestCount(null)', baseConfirmed);
    const baseAttemptClear = base.indexOf('saleAttemptRef.current = null', baseConfirmed);
    expect(baseConfirmed).toBeGreaterThanOrEqual(0);
    expect(baseAttemptClear).toBeGreaterThan(baseLocalReset);

    const wrapperReceipt = wrapper.indexOf('const receipt = buildSettlementReceipt');
    const wrapperReceiptState = wrapper.indexOf('setSettlementReceipt(receipt)', wrapperReceipt);
    const wrapperAttemptClear = wrapper.indexOf('saleAttemptRef.current = null', wrapperReceipt);
    expect(wrapperReceipt).toBeGreaterThanOrEqual(0);
    expect(wrapperAttemptClear).toBeGreaterThan(wrapperReceiptState);
  });

  it('routes normal, split, IndexedDB and legacy replay through idempotent RPCs', () => {
    const payment = read('src/features/pos/services/payment.ts');
    const sync = read('src/core/offline/syncEngine.ts');
    const legacy = read('src/features/pos/services/offlinePos.ts');

    expect(payment).toContain('posApi.processSaleIdempotent(settlementPayload)');
    expect(payment).toContain('posApi.processSaleSplitIdempotent(payload)');
    expect(sync).toContain('posApi.processSaleIdempotent(replayPayload)');
    expect(sync).toContain('item.payload.p_client_operation_key || item.client_id || item.id');
    expect(legacy).toContain('posApi.processSaleIdempotent');
  });

  it('uses a private server ledger, advisory transaction lock and payload mismatch guard', () => {
    const migration = read('supabase/migrations/20261002204500_pos_sale_idempotency_guard.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS private.pos_sale_idempotency');
    expect(migration).toContain('PRIMARY KEY (branch_id, operation_key)');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    expect(migration).toContain('IDEMPOTENCY_KEY_OWNER_MISMATCH');
    expect(migration).toContain('public.process_sale_idempotent');
    expect(migration).toContain('public.process_sale_split_idempotent');
    expect(migration).toContain('REVOKE ALL ON TABLE private.pos_sale_idempotency FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.process_sale_idempotent');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.process_sale_split_idempotent');
  });
});
