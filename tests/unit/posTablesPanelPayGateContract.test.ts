import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/pos/components/tables/TablesPanel.tsx', 'utf8');

describe('POS tables panel pay gate', () => {
  it('requires payment permission and a prior kitchen send', () => {
    expect(source).toContain('const perms = usePosPermissions()');
    expect(source).toContain('const canPaySentOrder = perms.canPay && Boolean(order.kitchen_sent_at)');
    expect(source).toContain('{canPaySentOrder && (');
  });
});
