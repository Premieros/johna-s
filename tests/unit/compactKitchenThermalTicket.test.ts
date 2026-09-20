import { describe, expect, it } from 'vitest';
import { buildStationTicketText } from '../../src/features/pos/services/localPrintAgent';
import type { KitchenSendItem } from '../../src/features/pos/types';

describe('compact kitchen thermal ticket', () => {
  it('keeps modifiers and notes directly under each item without wasting paper', () => {
    const ticket = buildStationTicketText(
      'Bar',
      [
        {
          product_name: 'Burger',
          quantity: 2,
          station_code: 'Bar',
          modifiers: [
            { option_name: 'جبنة إضافية', option_name_en: 'Extra Cheese' },
            { option_name: 'بدون بصل', option_name_en: 'No Onion' },
          ],
          notes: 'Well done',
        } as unknown as KitchenSendItem,
      ],
      {
        orderNumber: "Johna's-00330",
        tableName: 'Table 01',
        orderType: 'dine_in',
        guestCount: 2,
        isAr: false,
      },
    );

    expect(ticket).toContain('KITCHEN TICKET');
    expect(ticket).toContain('STATION\r\nBar');
    expect(ticket).toContain('Type: Dine In');
    expect(ticket).toContain('2 x Burger');
    expect(ticket).toContain('+ Extra Cheese');
    expect(ticket).toContain('+ No Onion');
    expect(ticket).toContain('Note: Well done');
    expect(ticket).not.toContain('END OF ORDER');
    expect(ticket).not.toContain('EGP');

    const blankLines = ticket.split('\r\n').filter((line) => line === '').length;
    expect(blankLines).toBeLessThanOrEqual(1);
  });

  it('prints Arabic labels without mixing English headings into them', () => {
    const ticket = buildStationTicketText(
      'بار',
      [
        {
          product_name: 'Water',
          quantity: 1,
          station_code: 'بار',
          modifiers: [{ option_name: 'بدون ثلج', option_name_en: 'No Ice' }],
          notes: 'ساقع',
        } as unknown as KitchenSendItem,
      ],
      {
        orderNumber: "Johna's-00331",
        tableName: 'Table 02',
        orderType: 'dine_in',
        guestCount: 1,
        isAr: true,
      },
    );

    expect(ticket).toContain('تذكرة المطبخ');
    expect(ticket).toContain('المحطة\r\nبار');
    expect(ticket).toContain('النوع: داخل الصالة');
    expect(ticket).toContain('+ بدون ثلج');
    expect(ticket).toContain('ملاحظة: ساقع');
    expect(ticket).not.toContain('KITCHEN TICKET');
  });
});
