import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Settings } from '@/lib/types';
import type { KitchenSendItem } from '../../src/features/pos/types';
import { buildReceiptFixedTemplate, buildReceiptHtml } from '../../src/features/pos/utils/printing';
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
      subtitle: 'NOT PAID',
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

  it('renders with enlarged fixed typography and only uses text fallback before template submission', () => {
    const agent = read('local-print-agent/agent.cjs');
    const frontendRenderer = read('src/features/pos/services/localPrintAgent.ts');
    const renderer = read('local-print-agent/template-print.ps1');

    expect(agent).toContain("const TEMPLATE_RENDERER_PATH = path.join(__dirname, 'template-print.ps1')");
    expect(agent).toContain('function isFixedThermalTemplate(template)');
    expect(agent).toContain('await printFixedTemplate(printer, template)');
    expect(agent).toContain(': await printText(printer, text)');
    expect(agent).toContain("renderer: result?.renderer || 'text-fallback'");

    expect(frontendRenderer).toContain("font-size: ${kitchen ? '11pt' : '12pt'}");
    expect(frontendRenderer).toContain("font-size: ${kitchen ? '26pt' : '30pt'}");
    expect(frontendRenderer).toContain('grid-template-columns: 8mm minmax(0, 1fr) 19mm 23mm;');
    expect(frontendRenderer).toContain('.station-card {');
    expect(frontendRenderer).toContain('.qty-badge {');
    expect(frontendRenderer).toContain('.grand-total { font-size: 17.5pt;');

    expect(renderer).toContain("$bodyFamily = 'Arial Narrow'");
    expect(renderer).toContain("$brandFamily = 'Arial'");
    expect(renderer).toContain("$(if ($isKitchen) { 20 } else { 23 })");
    expect(renderer).toContain("$(if ($isKitchen) { 10.8 } else { 11.5 })");
    expect(renderer).toContain("$(if ($isKitchen) { 15 } else { 16 })");
    expect(renderer).toContain("$totalFont = [System.Drawing.Font]::new($bodyFamily, 16.5");
    expect(renderer).toContain("[System.Drawing.Font]::new($brandFamily");
    expect(renderer).toContain("[System.Drawing.Font]::new($bodyFamily");
    expect(renderer).toContain('$paperHeightMm = 66 +');
    expect(renderer).toContain('$itemUnits += @($item.modifiers).Count * 5.8');
    expect(renderer).toContain("$g.DrawRectangle($strongPen, $badgeX, $y, $badgeW, 7.5)");
    expect(renderer).toContain("$unitHead = $(if ($isAr) { 'السعر' } else { 'UNIT' })");
    expect(renderer).toContain("$noteLabel = $(if ($isAr) { 'ملاحظة: ' } else { 'Note: ' })");
    expect(renderer).toContain('$doc.Print()');
  });
  it('updates only the Windows renderer without reinstalling or remapping printers', () => {
    const updater = read('local-print-agent/update-renderer.cmd');
    expect(updater).toContain('template-print.ps1');
    expect(updater).toContain('raw.githubusercontent.com/Premieros/johna-s/main/local-print-agent/template-print.ps1');
    expect(updater).toContain("Copy-Item -LiteralPath $target -Destination ($target + '.bak-' + $stamp) -Force");
    expect(updater).toContain('Move-Item -LiteralPath $tmp -Destination $target -Force');
    expect(updater).not.toContain('printer-config.json');
    expect(updater).not.toContain('agent.cjs');
    expect(updater).not.toContain('taskkill');
  });

  it('uses the same fixed professional customer form for preview without authorizing a print', async () => {
    const html = await buildReceiptHtml(
      {
        invoice: "Johna's-003400",
        branchName: 'Cleopatra',
        items: [{ name: 'Chicken Burger', qty: 2, price: 120, total: 240 }],
        subtotal: 240,
        discount: 10,
        tax: 0,
        total: 230,
        paid: 230,
        change: 0,
        date: '2026-09-21T20:30:00+03:00',
        customerName: 'Walk-in',
        orderTypeLabel: 'Dine In',
        tableName: 'Table 01',
        operatorName: 'cashier',
        payments: [{ method: 'cash', amount: 230 }],
      },
      {
        store_name: "Johna's",
        store_address: 'Alexandria',
        store_phone: '0123456789',
        currency: 'EGP',
        receipt_width_mm: 80,
        receipt_header: '',
        receipt_footer: '',
        receipt_show_tax: false,
      } as unknown as Settings,
      'en',
      false,
      { authorize: false },
    );

    expect(html).toContain('CUSTOMER RECEIPT');
    expect(html).toContain('CUSTOMER COPY');
    expect(html).toContain('grid-template-columns: 9mm minmax(0, 1fr) 18mm 20mm;');
    expect(html).toContain('Chicken Burger');
    expect(html).toContain('120 EGP');
    expect(html).toContain('240 EGP');
    expect(html).toContain('Alexandria');
    expect(html).toContain('Tel: 0123456789');
    expect(html).not.toContain('johns-print-auth');
  });

  it('reserves fixed LTR numeric columns so prices and totals cannot be visually clipped by RTL layout', async () => {
    const html = await buildReceiptHtml(
      {
        invoice: "Johna's-009999",
        branchName: 'Cleopatra',
        items: [{ name: 'Very Long Product Name For Number Safety', qty: 12, price: 123456.78, total: 1481481.36 }],
        subtotal: 1481481.36,
        discount: 0,
        tax: 0,
        total: 1481481.36,
        paid: 1481481.36,
        change: 0,
        date: '2026-09-21T20:30:00+03:00',
        customerName: '',
        payments: [{ method: 'card', amount: 1481481.36 }],
      },
      {
        store_name: "Johna's",
        currency: 'EGP',
        receipt_width_mm: 80,
        receipt_header: '',
        receipt_footer: '',
        receipt_show_tax: false,
      } as unknown as Settings,
      'ar',
      true,
      { authorize: false },
    );

    expect(html).toContain('grid-template-columns: 8mm minmax(0, 1fr) 19mm 23mm;');
    expect(html).toContain('white-space: nowrap;');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
    expect(html).toContain('direction: ltr;');
    expect(html).toContain('1,481,481.36 EGP');
    expect(html).toContain('123,456.78 EGP');
  });


});
