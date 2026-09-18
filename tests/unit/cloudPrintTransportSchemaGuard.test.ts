import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const verifier = fs.readFileSync('scripts/db/verify-schema.js', 'utf8');
const transportMigration = fs.readFileSync('supabase/migrations/20260918223500_restore_cloud_print_queue_execution.sql', 'utf8');

describe('cloud print transport regression guard', () => {
  it('keeps the transport helper in the schema critical-function set', () => {
    expect(verifier).toContain("'can_execute_cloud_print_kind'");
  });

  it('fails schema verification if per-job-kind permission coupling returns', () => {
    expect(verifier).toContain("Cloud print transport invariant");
    expect(verifier).toContain("p_kind = 'kitchen' and public.can_permission('pos.print_kitchen')");
    expect(verifier).toContain("p_kind in ('receipt','report') and public.can_permission('pos.receipt.print')");
    expect(verifier).toContain('!reintroducesPerKindCoupling');
    expect(verifier).toContain('|| !cloudPrintTransportInvariantOk');
  });

  it('locks the intended transport semantics in the canonical repair migration', () => {
    expect(transportMigration).toContain("p_kind IN ('kitchen','receipt','report')");
    expect(transportMigration).toContain("public.can_permission('settings.manage')");
    expect(transportMigration).toContain("public.can_permission('pos.print_kitchen')");
    expect(transportMigration).toContain("public.can_permission('pos.receipt.print')");
    expect(transportMigration).not.toContain("p_kind = 'kitchen' AND public.can_permission('pos.print_kitchen')");
  });
});
