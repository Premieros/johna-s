import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(process.cwd(),
  'src/features/admin/pages/SuperAdminConsolePage.tsx'), 'utf8');

describe('Super Admin operational settings are branch-specific', () => {
  it('removes global operational settings editor and its shared-row save path', () => {
    expect(page).not.toContain("key: 'general'");
    expect(page).not.toContain("activeTab === 'general'");
    expect(page).not.toContain('handleSaveGeneral');
    expect(page).not.toContain('setGeneralForm');
    expect(page).not.toContain('Save Enterprise Settings');
    expect(page).not.toContain('const { settings, branchSettingsMap, save, saveBranchSettings }');
    // Historic deep links to General must lead to the branch editor.
    expect(page).toContain("initialTab === 'general' ? 'branches_override'");
  });

  it('selects one explicit branch, reads that branch row, and saves its settings only', () => {
    expect(page).toContain("useState<string>('')");
    expect(page).toContain('branches.some((branch) => branch.id === targetBranchId)');
    expect(page).toContain('branchSettingsMap[targetBranchId]');
    expect(page).toContain('saveBranchSettings(targetBranchId, {');
    expect(page).toContain("branchFormLoadedFor !== targetBranchId");
    expect(page).toContain('data-testid="super-admin-selected-branch"');
    expect(page).toContain('data-testid="super-admin-save-branch-settings"');
  });

  it('supports independent branch tax, receipts, currency, stock and financial day without changing global defaults', () => {
    for (const field of [
      'tax_rate:', 'tax_enabled:', 'receipt_header:', 'receipt_footer:',
      'logo_url:', 'currency:', 'low_stock_threshold:', 'business_day_mode:',
      'business_day_start:', 'business_day_end:', 'auto_close_shift_at_day_end:',
    ]) {
      expect(page).toContain(field);
    }
    expect(page).toContain("'shift_span'");
    expect(page).not.toContain("'first_last_shift'");
    expect(page).not.toContain('Inherit enterprise default');
  });
});
