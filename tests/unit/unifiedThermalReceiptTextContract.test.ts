import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const printing = readFileSync('src/features/pos/utils/printing.ts', 'utf8');
const localAgent = readFileSync('src/features/pos/services/localPrintAgent.ts', 'utf8');
const cloudPrint = readFileSync('src/features/pos/services/cloudPrint.ts', 'utf8');

describe('unified thermal receipt text contract', () => {
  it('uses one visual text structure while keeping Arabic and English separate', () => {
    expect(printing).toContain("isAr ? 'حساب مبدئي' : 'OPEN CHECK'");
    expect(printing).toContain("isAr ? 'إيصال العميل' : 'CUSTOMER RECEIPT'");
    expect(printing).toContain("lines.push(heading(isAr ? 'الأصناف' : 'ITEMS'));");
    expect(printing).toContain("lines.push(heading(isAr ? 'الدفع' : 'PAYMENT'));");
    expect(printing).toContain("function thermalCenter");
    expect(printing).toContain("function thermalColumns");
    expect(printing).toContain("const columns = isCompactThermalWidth(width) ? 32 : 42;");
    expect(printing).not.toContain('*** حساب مبدئي / OPEN CHECK ***');
    expect(printing).not.toContain('*** إيصال دفع / PAYMENT RECEIPT ***');
    expect(printing).not.toContain('الأصناف / ITEMS');
    expect(printing).not.toContain('الدفع / PAYMENT');
  });

  it('uses the same ticket hierarchy for kitchen text without prices', () => {
    expect(localAgent).toContain("ar ? 'تذكرة المطبخ' : 'KITCHEN TICKET'");
    expect(localAgent).toContain("lines.push(ar ? 'المحطة' : 'STATION');");
    expect(localAgent).toContain("ar ? 'الطلب' : 'Order'");
    expect(localAgent).toContain("ar ? 'الوقت' : 'Time'");
    expect(localAgent).toContain("ar ? 'النوع' : 'Type'");
    expect(localAgent).toContain("ar ? 'الطاولة' : 'Table'");
    expect(localAgent).toContain("ar ? 'الأصناف' : 'ITEMS'");
    expect(localAgent).toContain("ar ? 'ملاحظة' : 'Note'");
    expect(localAgent).toContain('modifierNames(item, ar)');
    expect(localAgent).toContain('kitchenOrderTypeLabel(ctx.orderType, ar)');
    expect(localAgent).not.toContain('END OF ORDER');
    expect(localAgent).not.toContain('EGP');
  });

  it('does not change printer routing, queue transport, retry, or execution contracts', () => {
    expect(localAgent).toContain("export const PRINT_AGENT_URL = 'http://127.0.0.1:17654';");
    expect(localAgent).toContain('export async function executeSilentPrintDetailed');
    expect(localAgent).toContain('export async function printKitchenStationsLocally');
    expect(localAgent).toContain('fetchWithTimeout(`${PRINT_AGENT_URL}/print`');
    expect(localAgent).toContain('text: buildStationTicketText(station, stationItems, ctx)');
    expect(cloudPrint).toContain('Object.entries(groupKitchenItemsByStation(params.items))');
    expect(cloudPrint).toContain('p_station_code: station');
    expect(cloudPrint).toContain("supabase.rpc('enqueue_cloud_kitchen_print'");
    expect(cloudPrint).toContain('KITCHEN_ENQUEUE_MAX_ATTEMPTS = 3');
    expect(cloudPrint).toContain('idempotencyKey = `kitchen:${station}:${keySeed}`');
  });
});
