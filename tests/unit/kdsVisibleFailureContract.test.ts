import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/inventory/pages/KitchenDisplayPage.tsx', 'utf8');

describe('KDS visible failure contract', () => {
  it('does not replace the last known queue with an empty list on RPC failure', () => {
    const catchAt = source.indexOf("// Never turn a KDS transport/permission failure into a fake empty queue.");
    expect(catchAt).toBeGreaterThanOrEqual(0);
    const catchBody = source.slice(catchAt, source.indexOf('} finally {', catchAt));
    expect(catchBody).toContain('setLoadError(errorMessage(error))');
    expect(catchBody).not.toContain('setItems([])');
  });

  it('shows permission/transport failures and retry instead of false empty state', () => {
    expect(source).toContain('kds-load-error');
    expect(source).toContain("can('pos.kds_view')");
    expect(source).toContain('!loading && !items.length && !loadError');
  });
});
