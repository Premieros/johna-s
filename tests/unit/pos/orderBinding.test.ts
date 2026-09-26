import { describe, expect, it } from 'vitest';
import { resolveOrderBindingForSave } from '@/features/pos/utils/orderBinding';

describe('resolveOrderBindingForSave', () => {
  it('preserves a known table binding for an active order even if transient UI type drifts', () => {
    expect(resolveOrderBindingForSave({
      activeOrderId: 'order-1',
      orderType: 'takeaway',
      tableId: 'table-48',
      activeTableId: null,
    })).toEqual({ orderType: 'dine_in', tableId: 'table-48' });
  });

  it('falls back to the active table identity while an active order is being rehydrated', () => {
    expect(resolveOrderBindingForSave({
      activeOrderId: 'order-1',
      orderType: 'takeaway',
      tableId: null,
      activeTableId: 'table-48',
    })).toEqual({ orderType: 'dine_in', tableId: 'table-48' });
  });

  it('keeps ordinary takeaway creation table-free', () => {
    expect(resolveOrderBindingForSave({
      activeOrderId: null,
      orderType: 'takeaway',
      tableId: null,
    })).toEqual({ orderType: 'takeaway', tableId: null });
  });

  it('keeps a new dine-in draft bound to its selected table', () => {
    expect(resolveOrderBindingForSave({
      activeOrderId: null,
      orderType: 'dine_in',
      tableId: 'table-7',
    })).toEqual({ orderType: 'dine_in', tableId: 'table-7' });
  });
});
