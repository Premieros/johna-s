import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  'supabase/migrations/20261002202952_supplier_payment_allocation_grant_hardening_20261002.sql',
  'utf8',
);

describe('supplier payment allocation grant hardening', () => {
  it('removes all direct mutation privileges from API roles', () => {
    expect(migration).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
    );
    expect(migration).toContain(
      'FROM PUBLIC, anon, authenticated, service_role',
    );
  });

  it('retains read-only visibility for authorized app/service reads', () => {
    expect(migration).toContain('GRANT SELECT');
    expect(migration).toContain('TO authenticated, service_role');
  });
});
