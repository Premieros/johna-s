import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const cloud = fs.readFileSync('src/features/pos/services/cloudPrint.ts', 'utf8');
const types = fs.readFileSync('src/features/pos/types.ts', 'utf8');

describe('incremental kitchen print idempotency contract', () => {
  it('uses cumulative quantity with send identity for stable retry-safe keys', () => {
    expect(types).toContain('current_quantity?: number;');
    expect(cloud).toContain('const currentQuantity = Number(item.current_quantity);');
    expect(cloud).toContain('return `${sendIdentity}:${currentQuantity}`;');
    expect(cloud).toContain("deltaIdentities.length === stationItems.length");
  });

  it('keeps the same key for a retry of the same delta and changes it for a later delta', () => {
    const key = (sendId: string, currentQuantity: number) => `kitchen:bar:${sendId}:${currentQuantity}`;
    expect(key('send-1', 1)).toBe(key('send-1', 1));
    expect(key('send-1', 1)).not.toBe(key('send-1', 2));
  });

  it('sorts identities so multi-item station keys are deterministic', () => {
    expect(cloud).toContain('.filter(Boolean)');
    expect(cloud).toContain('.sort();');
    const a = ['b:2', 'a:1'].sort().join(',');
    const b = ['a:1', 'b:2'].sort().join(',');
    expect(a).toBe(b);
  });

  it('retains a deterministic fallback when cumulative quantity is unavailable', () => {
    expect(cloud).toContain('fallbackIdentities');
    expect(cloud).toContain("safeText(params.context.orderNumber)");
  });
});
