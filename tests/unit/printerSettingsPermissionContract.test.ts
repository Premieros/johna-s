import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

describe('permission-first desktop printer routing contract', () => {
  it('keeps printer management hidden behind settings.manage and only on settings surfaces', () => {
    const panel = read('src/features/pos/components/settings/PrinterSettingsPanel.tsx');
    const launcher = read('src/features/pos/components/settings/PrinterSettingsLauncher.tsx');
    const app = read('src/app/App.tsx');

    expect(panel).toContain("can('settings.manage')");
    expect(panel).toContain('if (!canManagePrinters) return null');
    expect(launcher).toContain("can('settings.manage')");
    expect(launcher).toContain('pathname.startsWith(APP_ROUTES.settings)');
    expect(app).toContain('<PrinterSettingsLauncher />');
    expect(panel).toContain("main: ['main', 'kitchen', 'grill', 'salad', 'dessert', 'fryer']");
    expect(panel).toContain("drinks: ['drinks', 'barista', 'bar']");
  });

  it('preserves strict kitchen routing and does not introduce a DB print queue', () => {
    const printAgent = read('src/features/pos/services/localPrintAgent.ts');

    expect(printAgent).toContain('items.some((item) => !safeText(item.station_code))');
    expect(printAgent).toContain('`${PRINT_AGENT_URL}/config`');
    expect(printAgent).toContain('isRunningInElectron()');
    expect(printAgent).toContain('if (!isSilentPrintEnabled()) return false');
    expect(printAgent).toContain("method: 'POST'");
    expect(printAgent).not.toContain("from('print_jobs')");
    expect(printAgent).not.toContain('scpovyrqmsbiduanykod');
  });

  it('pins Electron to johna-s and keeps renderer isolation enabled', () => {
    const electron = read('electron/main.cjs');

    expect(electron).toContain('https://premieros.github.io/johna-s/');
    expect(electron).not.toContain('europe-west1.run.app');
    expect(electron).toContain('contextIsolation: true');
    expect(electron).toContain('nodeIntegration: false');
    expect(electron).toContain('sandbox: true');
  });
});
