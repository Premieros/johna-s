import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Cleopatra headless print agent contract', () => {
  it('is locked to production Cleopatra without service-role credentials', () => {
    const build = read('print-agent-headless/BuildConfig.cs');
    const api = read('print-agent-headless/SupabaseApi.cs');
    expect(build).toContain('https://azzdesuowpdcoflmyezn.supabase.co');
    expect(build).toContain('279e6662-e901-40b2-9170-7dda0b471ba7');
    expect(build).toContain('__VITE_SUPABASE_ANON_KEY__');
    expect(api).not.toMatch(/service[_-]?role/i);
    expect(api).toContain('claim_cloud_print_jobs');
    expect(api).toContain('start_cloud_print_job');
    expect(api).toContain('complete_cloud_print_job');
  });

  it('stores only a DPAPI-protected refresh token and autostarts hidden', () => {
    const config = read('print-agent-headless/AppConfig.cs');
    expect(config).toContain('ProtectedData.Protect');
    expect(config).toContain('DataProtectionScope.CurrentUser');
    expect(config).toContain('ProtectedRefreshToken');
    expect(config).not.toContain('Password { get; set; }');
    expect(config).toContain('--background');
  });

  it('enforces print-only permissions before background polling', () => {
    const worker = read('print-agent-headless/CloudPrintWorker.cs');
    const setup = read('print-agent-headless/SetupForm.cs');
    expect(worker).toContain('CanExecuteKindAsync(_session.AccessToken, "kitchen"');
    expect(worker).toContain('CanExecuteKindAsync(_session.AccessToken, "receipt"');
    expect(worker).toContain('DEVICE_PRINT_PERMISSIONS_MISSING');
    expect(setup).toContain('pos.print_kitchen');
    expect(setup).toContain('pos.receipt.print');
  });

  it('polls without browser and routes cashier jobs to the Cleopatra cash printer', () => {
    const worker = read('print-agent-headless/CloudPrintWorker.cs');
    const project = read('print-agent-headless/PremierCleopatraPrintAgent.csproj');
    expect(worker).toContain('_api.ClaimAsync');
    expect(worker).toContain('Task.Delay(700');
    expect(worker).toContain('string.Equals(station, "cashier"');
    expect(worker).toContain('_config.Routes.TryGetValue("كاش"');
    expect(project).not.toContain('Microsoft.Web.WebView2');
  });

  it('renders Arabic to raw ESC/POS raster before printing', () => {
    const printer = read('print-agent-headless/RawEscPosPrinter.cs');
    expect(printer).toContain('TextRenderingHint.AntiAliasGridFit');
    expect(printer).toContain('StringFormatFlags.DirectionRightToLeft');
    expect(printer).toContain('pDataType = "RAW"');
    expect(printer).toContain('0x1D; data[offset++] = 0x76');
    expect(printer).toContain('0x1D; data[offset++] = 0x56');
  });
});
