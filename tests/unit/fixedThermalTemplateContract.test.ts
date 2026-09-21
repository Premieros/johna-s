import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Settings } from '@/lib/types';
import type { KitchenSendItem } from '../../src/features/pos/types';
import { buildReceiptFixedTemplate } from '../../src/features/pos/utils/printing';
import { buildFixedThermalTemplateHtml, buildKitchenFixedTemplate } from '../../src/features/pos/services/localPrintAgent';

const read = (path: string) => readFileSync(path, 'utf8');

describe('fixed thermal receipt template contract', () => {
  it('builds the approved fixed customer form from live receipt data', () => {
    const template = buildReceiptFixedTemplate(
      {
        invoice: "Johna's-003307",
        branchName: 'Smouha Club',
        items: [{ name: 'Water', qty: 1, price: 10, total: 10 }],
        subtotal: 10,
        discount: 0,
        tax: 0,
        total: 10,
        paid: 10,
        change: 0,
        date: '2026-09-20T17:47:00+03:00',
        customerName: '',
        tableName: 'Table 04',
        orderTypeLabel: 'Dine In',
        guestCount: 2,
        operatorName: 'eslam',
        isOpenOrder: true,
      },
      {
        store_name: "Johna's",
        currency: 'EGP',
        receipt_width_mm: 72,
        receipt_header: '',
        receipt_footer: '',
        receipt_show_tax: false,
      } as unknown as Settings,
      'en',
      false,
    );

    expect(template).toMatchObject({
      version: 1,
      kind: 'customer',
      paperWidthMm: 80,
      storeName: "JOHNA'S",
      storeSubtitle: 'RESTAURANT',
      title: 'OPEN CHECK',
      itemsHeading: 'ITEMS',
    });
    expect(template.meta).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Order', value: "Johna's-003307" }),
      expect.objectContaining({ label: 'Table', value: 'Table 04' }),
      expect.objectContaining({ label: 'Guests', value: '2' }),
    ]));
    expect(template.items[0]).toMatchObject({ qty: '1', name: 'Water', total: '10 EGP' });
    expect(template.totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Subtotal', value: '10 EGP' }),
      expect.objectContaining({ label: 'TOTAL', value: '10 EGP', emphasis: true }),
    ]));
  });

  it('keeps kitchen form compact while preserving modifiers and notes', () => {
    const item = {
      send_id: 'send-1',
      order_item_id: 'oi-1',
      product_id: 'p-1',
      product_name: 'Burger',
      unit_name: null,
      station_code: 'main',
      quantity: 2,
      current_quantity: 2,
      unit_price: 100,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 200,
      notes: 'Well done',
      modifiers: [
        { option_name: 'جبنة إضافية', option_name_en: 'Extra Cheese' },
        { option_name: 'بدون بصل', option_name_en: 'No Onion' },
      ],
    } as unknown as KitchenSendItem;

    const template = buildKitchenFixedTemplate('Main Kitchen', [item], {
      orderNumber: "Johna's-003307",
      tableName: 'Table 04',
      orderType: 'dine_in',
      guestCount: 2,
      isAr: false,
    }, 80);

    expect(template.kind).toBe('kitchen');
    expect(template.title).toBe('KITCHEN TICKET');
    expect(template.subtitle).toBe('KITCHEN COPY');
    expect(template.station).toBe('Main Kitchen');
    expect(template.items[0]).toMatchObject({
      qty: '2',
      name: 'Burger',
      modifiers: ['Extra Cheese', 'No Onion'],
      notes: 'Well done',
    });
    expect(template.totals).toBeUndefined();
    expect(template.footerLines).toEqual(['END OF ORDER']);
  });

  it('converts the same fixed form to HTML for the already-installed Electron agent', () => {
    const template = buildKitchenFixedTemplate('Main Kitchen', [{
      send_id: 'send-2',
      order_item_id: 'oi-2',
      product_id: 'p-2',
      product_name: 'Burger',
      unit_name: null,
      station_code: 'main',
      quantity: 1,
      current_quantity: 1,
      unit_price: 100,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 100,
      notes: 'No salt',
      modifiers: [{ option_name: 'جبنة', option_name_en: 'Cheese' }],
    } as unknown as KitchenSendItem], {
      orderNumber: "Johna's-003308",
      tableName: 'Table 05',
      orderType: 'dine_in',
      guestCount: 1,
      isAr: false,
    }, 80);

    const html = buildFixedThermalTemplateHtml(template);
    expect(html).toContain('width: 80mm');
    expect(html).toContain('font-family: "Arial Narrow"');
    expect(html).toContain('KITCHEN TICKET');
    expect(html).toContain('Main Kitchen');
    expect(html).toContain('+ Cheese');
    expect(html).toContain('Note: No salt');
    expect(html).toContain('END OF ORDER');
  });

  it('renders with fixed Windows typography and only uses text fallback before template submission', () => {
    const agent = read('local-print-agent/agent.cjs');
    const renderer = read('local-print-agent/template-print.ps1');

    expect(agent).toContain("const TEMPLATE_RENDERER_PATH = path.join(__dirname, 'template-print.ps1')");
    expect(agent).toContain('function isFixedThermalTemplate(template)');
    expect(agent).toContain('await printFixedTemplate(printer, template)');
    expect(agent).toContain(': await printText(printer, text)');
    expect(agent).toContain("renderer: result?.renderer || 'text-fallback'");

    expect(renderer).toContain("$bodyFamily = 'Arial Narrow'");
    expect(renderer).toContain("$brandFamily = 'Arial'");
    expect(renderer).toContain("[System.Drawing.Font]::new($brandFamily");
    expect(renderer).toContain("[System.Drawing.Font]::new($bodyFamily");
    expect(renderer).toContain('$paperHeightMm = 50 +');
    expect(renderer).toContain('$itemUnits += @($item.modifiers).Count * 4.5');
    expect(renderer).toContain("$noteLabel = $(if ($isAr) { 'ملاحظة: ' } else { 'Note: ' })");
    expect(renderer).toContain('$doc.Print()');
  });
});
