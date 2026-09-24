import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260924075209_inventory_ledger_visibility_context_cache.sql',
  'utf8',
);

describe('financial journal RLS Super Admin fast-path contract', () => {
  it('adds a statement-level Super Admin initPlan to both journal tables', () => {
    const occurrences = migration.match(/\(SELECT public\.is_pos_admin\(\)\)/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);

    expect(migration).toContain('DROP POLICY IF EXISTS auth_select_journal_entries');
    expect(migration).toContain('DROP POLICY IF EXISTS financial_visibility_journal_entries');
    expect(migration).toContain('DROP POLICY IF EXISTS auth_select_journal_entry_lines');
    expect(migration).toContain('DROP POLICY IF EXISTS financial_visibility_journal_entry_lines');
  });

  it('preserves the existing non-admin branch and financial visibility predicates', () => {
    expect(migration).toContain('public.user_may_access_branch(branch_id)');
    expect(migration).toContain('private.financial_reference_visible(');
    expect(migration).toContain('public.user_may_access_branch(je.branch_id)');
    expect(migration).toContain('private.journal_entry_read_visible_by_id(journal_entry_id)');
  });

  it('keeps financial visibility policies restrictive', () => {
    expect(migration).toMatch(
      /CREATE POLICY financial_visibility_journal_entries[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR SELECT/,
    );
    expect(migration).toMatch(
      /CREATE POLICY financial_visibility_journal_entry_lines[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR SELECT/,
    );
  });

  it('does not touch printing or kitchen paths', () => {
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('send_to_kitchen');
    expect(migration).not.toContain('printer');
  });
});
