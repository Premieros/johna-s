import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
const activeOrders = read('src/features/pos/pages/ActiveOrdersPage.tsx');
const kds = read('src/features/inventory/pages/KitchenDisplayPage.tsx');
const transferOrder = read('src/features/pos/components/tables/TransferOrderModal.tsx');
const transferItem = read('src/features/pos/components/tables/TransferItemModal.tsx');
const transferItems = read('src/features/pos/components/tables/TransferItemsModal.tsx');
const productBrowser = read('src/features/pos/components/catalog/ProductBrowser.tsx');

describe('POS user-facing error surface contract', () => {
  it('normalizes local transfer errors before rendering them', () => {
    for (const source of [transferOrder, transferItem, transferItems]) {
      expect(source).toContain("userFacingErrorMessage");
    }

    expect(transferOrder).not.toContain('setOperatorError(error.message)');
    expect(transferOrder).not.toContain('setErrorMsg(error.message)');
    expect(transferItem).not.toContain('setError(fetchError.message)');
    expect(transferItem).not.toContain('setError(rpcError.message)');
    expect(transferItems).not.toContain('setError(fetchError.message)');
    expect(transferItems).not.toContain('setError(rpcError.message)');
  });

  it('keeps KDS cards visible while surfacing translated load/action failures', () => {
    expect(kds).toContain("userFacingErrorMessage");
    expect(kds).toContain("setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'))");
    expect(kds).toContain("POS_KDS_UPDATE_REQUIRED");
    expect(kds).not.toContain('catch { /* keep KDS interaction quiet */ }');
  });

  it('distinguishes missing shift from missing order permission in the catalog', () => {
    expect(productBrowser).toContain("addBlockReason: 'shift' | 'permission' | null");
    expect(productBrowser).toContain("لا تملك صلاحية إنشاء أو تعديل الطلب الحالي");
    expect(productBrowser).toContain("addBlockReason === 'shift' && can('shifts.view')");
    expect(productBrowser).not.toContain('ممنوع إضافة منتجات بدون شفت مفتوح');
  });

  it('blocks POS only for unrecovered product-catalog failures', () => {
    expect(workspace).toContain('let productLoadError: unknown = null;');
    expect(workspace).toContain('const secondaryErrors: unknown[] = [];');
    expect(workspace).toContain('Only a product-catalog failure can block POS after offline fallback.');
    expect(workspace).toContain('data-testid="pos-load-warning"');
    expect(workspace).toContain("userFacingErrorMessage(productLoadError, isAr ? 'ar' : 'en')");
    expect(workspace).not.toContain("setLoadError(errors.join('\\n'))");
  });

  it('normalizes active-order realtime/action failures at the UI boundary', () => {
    expect(activeOrders).toContain("userFacingErrorMessage(error, isAr ? 'ar' : 'en')");
    expect(activeOrders).toContain("userFacingErrorMessage(updateError, isAr ? 'ar' : 'en')");
    expect(activeOrders).not.toContain("show(updateError.message, 'error')");
  });
});
