import { describe, expect, it, vi } from 'vitest';
import { loadSageIdentitySnapshot } from '@/features/catalog/services/sageIdentitySnapshot';

const BRANCH = '19c3fd23-d784-455b-8840-f4f2ac619651';
const OTHER_BRANCH = '279e6662-e901-40b2-9170-7dda0b471ba7';
const products = [{
  id: '33333333-3333-4333-8333-333333333333',
  branch_id: BRANCH,
  name: 'Sage manufactured item',
  sku: null,
  product_type: 'manufactured' as const,
  is_active: true,
}];
const setup = () => ({
  branchId: BRANCH,
  hasUnchangedScope: vi.fn(() => true),
  countBranchProducts: vi.fn(async () => 1 as number | null),
  fetchAllProducts: vi.fn(async () => products),
});

describe('Sage authorized branch identity read snapshot', () => {
  it('reconciles count with full fetch and returns read-only identity-preserving array', async () => {
    const opts = setup();
    const result = await loadSageIdentitySnapshot(opts);
    expect(result).toMatchObject({
      branchId: BRANCH, readOnly: true, canImport: false,
      products: [{ id: products[0].id, branch_id: BRANCH, sku: null,
        product_type: 'manufactured' }],
    });
    expect(opts.countBranchProducts).toHaveBeenCalledWith(BRANCH);
    expect(opts.fetchAllProducts).toHaveBeenCalledOnce();
    expect(opts.hasUnchangedScope).toHaveBeenCalledTimes(4);
  });

  it('stops before any request when user scope changed', async () => {
    const opts = setup();
    opts.hasUnchangedScope.mockReturnValue(false);
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('scope changed');
    expect(opts.countBranchProducts).not.toHaveBeenCalled();
    expect(opts.fetchAllProducts).not.toHaveBeenCalled();
  });

  it('stops after database count when branch or user changes in-flight', async () => {
    const opts = setup();
    opts.hasUnchangedScope.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('scope changed');
    expect(opts.fetchAllProducts).not.toHaveBeenCalled();
  });

  it('stops before download when branch changes while reading results', async () => {
    const opts = setup();
    opts.hasUnchangedScope.mockReturnValueOnce(true)
      .mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('scope changed');
    expect(opts.fetchAllProducts).toHaveBeenCalledOnce();
  });

  it('rejects missing count, invalid count and truncated source', async () => {
    for (const count of [null, -1, Number.NaN, 0.25]) {
      const opts = setup();
      opts.countBranchProducts = vi.fn(async () => count);
      await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('verify');
      expect(opts.fetchAllProducts).not.toHaveBeenCalled();
    }
    const opts = setup();
    opts.countBranchProducts = vi.fn(async () => 2);
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('incomplete');
  });

  it('rejects excessive count before fetching or exporting anything', async () => {
    const opts = setup();
    opts.countBranchProducts = vi.fn(async () => 20_001);
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('row limit');
    expect(opts.fetchAllProducts).not.toHaveBeenCalled();
  });

  it('preserves branch identity instead of accepting a mixed-branch result', async () => {
    const opts = setup();
    opts.fetchAllProducts = vi.fn(async () => [{ ...products[0], branch_id: OTHER_BRANCH }]);
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('foreign-branch');
  });

  it('does not swallow a protected database read error', async () => {
    const opts = setup();
    opts.countBranchProducts = vi.fn(async () => { throw new Error('RLS forbidden'); });
    await expect(loadSageIdentitySnapshot(opts)).rejects.toThrow('RLS forbidden');
    expect(opts.fetchAllProducts).not.toHaveBeenCalled();
  });
});
