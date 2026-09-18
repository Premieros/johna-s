import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('cloud print operational permission contract', () => {
  it('keeps printer settings admin-only while allowing operational agent execution permissions', () => {
    const agent = readFileSync('src/features/pos/components/settings/CloudPrintAgent.tsx', 'utf8');
    const settings = readFileSync('src/features/pos/components/settings/PrinterSettingsPanel.tsx', 'utf8');

    expect(settings).toContain("const canManagePrinters = can('settings.manage')");
    expect(agent).toContain("can('settings.manage')");
    expect(agent).toContain("can('pos.print_kitchen')");
    expect(agent).toContain("can('pos.receipt.print')");
    expect(agent).not.toContain("if (!user?.id || !can('settings.manage')) return;");
  });

  it('keeps queue execution permission-scoped by job kind', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918185500_cloud_print_agent_operational_permissions.sql',
      'utf8',
    );

    expect(migration).toContain("p_kind = 'kitchen' AND public.can_permission('pos.print_kitchen')");
    expect(migration).toContain("p_kind IN ('receipt','report') AND public.can_permission('pos.receipt.print')");
    expect(migration).not.toContain("p_kind = 'test'");
    expect(migration).toContain('public.can_execute_cloud_print_kind(kind)');
  });
});
