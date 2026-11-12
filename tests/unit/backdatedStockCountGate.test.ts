import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('backdated stock count rollout gates', () => {
  const foundation = readFileSync('supabase/migrations/20261031190000_backdated_stock_count_cutoff_foundation.sql', 'utf8');
  const guard = readFileSync('supabase/migrations/20261031191000_guard_backdated_stock_count_posting.sql', 'utf8');

  it('adds an optional cutoff without rewriting pre-existing dates or stock', () => {
    expect(foundation).toContain('ADD COLUMN IF NOT EXISTS counted_at timestamptz');
    expect(foundation).not.toMatch(/UPDATE\s+public\.stock_counts/i);
  });
  it('rejects future cutoffs and immutable approved cutoffs server-side', () => {
    expect(guard).toContain('STOCK_COUNT_FUTURE_CUTOFF');
    expect(guard).toContain("OLD.status <> 'draft'");
    expect(guard).toContain('STOCK_COUNT_CUTOFF_LOCKED');
  });
  it('prevents all cutoff-tagged sessions from passing the legacy apply writer', () => {
    expect(guard).toContain("NEW.status = 'applied'");
    expect(guard).toContain('STOCK_COUNT_HISTORICAL_APPLY_NOT_READY');
    expect(guard).toContain('BEFORE INSERT OR UPDATE ON public.stock_counts');
  });
});
