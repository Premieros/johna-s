import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexProposal = readFileSync('scripts/experiments/oct09_fifo_issue_index_candidate.sql', 'utf8');

describe('FIFO issue index candidate remains safe and isolated', () => {
  it('requires concurrent creation and matches FIFO recent-issue filter', () => {
    expect(indexProposal).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
    expect(indexProposal).toMatch(/raw_material_id, branch_id, warehouse_id, created_at DESC NULLS LAST, id DESC/);
    expect(indexProposal).toMatch(/WHERE quantity < 0/);
    expect(indexProposal).toMatch(/COALESCE\(unit_cost, 0\) > 0/);
    expect(indexProposal).toMatch(/COALESCE\(batch_number, ''\) NOT LIKE 'OV-%'/);
  });
});
