import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260925005500_raw_fifo_orphan_sale_journal_fallback.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('raw FIFO orphan-sale journal fallback contract', () => {
  it('routes missing sale headers to a dedicated journal-backed fallback', () => {
    expect(migration).toContain('public._fifo_adjust_orphan_sale_cogs_delta');
    expect(migration).toContain('FIFO_ORPHAN_SALE_JOURNAL_AMBIGUOUS');
    expect(migration).toContain("'orphan_sale_fallback',true");
  });

  it('keeps original sale journals immutable and writes a separate reconciliation journal', () => {
    expect(migration).toContain("'fifo_cogs_reconcile'");
    expect(migration).toContain('FIFO orphan sale COGS reconciliation');
    expect(migration).not.toContain('WHERE journal_entry_id=v_base_entry.id;');
  });

  it('is reversible by accumulating signed deltas back to zero', () => {
    expect(migration).toContain('exact_delta=public.raw_fifo_orphan_sale_cogs_adjustments.exact_delta+EXCLUDED.exact_delta');
    expect(migration).toContain('IF v_target_posted=0 THEN');
    expect(migration).toContain('DELETE FROM public.raw_fifo_orphan_sale_cogs_adjustments');
  });

  it('fails closed on ambiguous/mixed state', () => {
    expect(migration).toContain('FIFO_ORPHAN_SALE_HEADER_STILL_EXISTS');
    expect(migration).toContain('FIFO_ORPHAN_SALE_NORMAL_ADJUSTMENT_EXISTS');
    expect(migration).toContain('FIFO_ORPHAN_SALE_RECONCILE_JOURNAL_ALREADY_EXISTS');
  });
});
