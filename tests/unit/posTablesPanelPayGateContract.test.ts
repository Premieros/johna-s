import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/pos/components/tables/TablesPanel.tsx', 'utf8');
const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');

describe('POS tables panel pay gate', () => {
  it('requires payment permission and an actual prior kitchen send', () => {
    expect(source).toContain('const perms = usePosPermissions()');
    expect(source).toContain('const canPaySentOrder = perms.canPay && (kitchenSendsByOrder[order.id]?.length || 0) > 0');
    expect(source).toContain('{canPaySentOrder && (');
    expect(workspace).toContain('kitchenSendsByOrder={kitchenSendsByOrder}');
  });
});
