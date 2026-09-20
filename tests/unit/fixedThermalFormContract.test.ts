import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const printing = readFileSync('src/features/pos/utils/printing.ts', 'utf8');
const localAgent = readFileSync('src/features/pos/services/localPrintAgent.ts', 'utf8');
const cloudPrint = readFileSync('src/features/pos/services/cloudPrint.ts', 'utf8');
const cloudAgent = readFileSync('src/features/pos/components/settings/CloudPrintAgent.tsx', 'utf8');
const electronMain = readFileSync('electron/main.cjs', 'utf8');
const frozenV7 = readFileSync('config/smouha-print-agent-v7.lock.json', 'utf8');

describe('fixed thermal form contract', () => {
  it('renders the approved customer form hierarchy with real typography', () => {
    expect(printing).toContain('class="brand"');
    expect(printing).toContain('>RESTAURANT</div>');
    expect(printing).toContain('class="title-band"');
    expect(printing).toContain('Good Food Brings People Together');
    expect(printing).toContain('class="item-grid item-head"');
    expect(printing).toContain("isAr ? 'الكمية' : 'QTY'");
    expect(printing).toContain("isAr ? 'الصنف' : 'ITEM'");
    expect(printing).toContain("isAr ? 'السعر' : 'PRICE'");
    expect(printing).toContain('class="summary-row grand-total"');
    expect(printing).toContain('font-family: "Arial Narrow", Tahoma, Arial, "Segoe UI", sans-serif');
    expect(printing).toContain('font-size: ${compact ? 25 : 31}px');
  });

  it('renders a compact kitchen form with modifiers and notes but no prices', () => {
    const start = localAgent.indexOf('export function buildStationTicketHtml');
    const end = localAgent.indexOf('async function fetchWithTimeout', start);
    const form = localAgent.slice(start, end);

    expect(form).toContain('JOHNA\'S');
    expect(form).toContain('KITCHEN TICKET');
    expect(form).toContain('KITCHEN COPY');
    expect(form).toContain('modifierNames(item, ar)');
    expect(form).toContain('class="modifier"');
    expect(form).toContain("ar ? 'ملاحظة' : 'NOTE'");
    expect(form).toContain('END OF ORDER');
    expect(form).toContain('pageHeightMm');
    expect(form).not.toContain('EGP');
    expect(form).not.toContain('unit_price');
  });

  it('keeps canonical text beside the versioned fixed form for safe fallback', () => {
    expect(cloudPrint).toContain('fixedFormHtml?: string');
    expect(cloudPrint).toContain('rendererVersion?: number');
    expect(cloudPrint).toContain('text: buildStationTicketText');
    expect(cloudPrint).toContain('fixedFormHtml: buildStationTicketHtml');
    expect(cloudPrint).toContain('rendererVersion: 1');
    expect(printing).toContain('text: pending.plainText');
    expect(printing).toContain('fixedFormHtml: queueSafeReceiptFormHtml(html)');
  });

  it('uses the form only on an HTML-capable agent and leaves legacy text fallback intact', () => {
    expect(cloudAgent).toContain("const fixedFormHtml = job.payload?.rendererVersion === 1");
    expect(cloudAgent).toContain('html: fixedFormHtml || (isThermalDocument ? undefined : job.payload?.html)');
    expect(localAgent).toContain("text: options.text || (options.html ? htmlToThermalText(options.html) : '')");
    expect(electronMain).toContain('const printableHtml = options.html');
    expect(electronMain).toContain('printBackground: true');
    expect(electronMain).toContain('silent: true');
  });

  it('does not alter the frozen Smouha v7 identity or protected RPC names', () => {
    expect(frozenV7).toContain('"status": "FROZEN"');
    expect(frozenV7).toContain('"agent_version": 7');
    expect(frozenV7).toContain('"PremierSmouhaPrintAgentV07.exe"');
    expect(frozenV7).toContain('"claim_cloud_print_jobs"');
    expect(frozenV7).toContain('"start_cloud_print_job"');
    expect(frozenV7).toContain('"complete_cloud_print_job"');
    expect(frozenV7).toContain('"can_execute_cloud_print_kind"');
  });
});
