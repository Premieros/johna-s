import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260930193000_stale_client_duplicate_sent_line_guard.sql','utf8');

describe('stale client duplicate sent line guard', () => {
  it('rejects duplicate same-configuration inserts after kitchen history exists', () => {
    expect(migration).toContain('STALE_CLIENT_DUPLICATE_LINE');
    expect(migration).toContain('JOIN public.order_kitchen_sends s ON s.order_item_id = existing.id');
    expect(migration).toContain("v_requested_item_id IS NULL");
  });
});
