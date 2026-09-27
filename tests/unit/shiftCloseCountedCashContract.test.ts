import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/trade/pages/ShiftsPage.tsx', 'utf8');

describe('shift close counted-cash contract', () => {
  it('never pre-fills physically counted cash from the expected drawer amount', () => {
    expect(source).toContain("actual_amount: number | ''");
    expect(source).toContain("setCloseForm({ actual_amount: '', notes: '' })");
    expect(source).not.toContain("setCloseForm({ actual_amount: expected, notes: '' })");
  });

  it('blocks normal and open-order close until counted cash is entered', () => {
    expect(source.match(/closeForm\.actual_amount === '' \|\| !Number\.isFinite\(closeForm\.actual_amount\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("disabled={closing || closeForm.actual_amount === ''}");
  });
});
