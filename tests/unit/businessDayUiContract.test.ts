import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const settingsPage = fs.readFileSync('src/features/admin/pages/SettingsControlCenterPage.tsx','utf8');
const shiftsPage = fs.readFileSync('src/features/trade/pages/ShiftsPage.tsx','utf8');
const dayReport = fs.readFileSync('src/features/trade/services/dayClosingReport.ts','utf8');

describe('business-day UI contract', () => {
  it('exposes both business-day boundary modes in branch settings', () => {
    expect(settingsPage).toContain('business_day_mode');
    expect(settingsPage).toContain('fixed_time');
    expect(settingsPage).toContain('shift_span');
    expect(settingsPage).toContain('وقت بداية اليوم');
    expect(settingsPage).toContain('وقت نهاية اليوم');
    expect(settingsPage).toContain('من أول شفت بعد وقت البداية إلى آخر شفت مغلق');
  });

  it('does not offer opening another shift when the target branch already has one', () => {
    expect(shiftsPage).toContain('targetOpenShift');
    expect(shiftsPage).toContain("can('shifts.open') && !targetOpenShift");
    expect(shiftsPage).toContain('يوجد شفت مفتوح بالفعل لهذا الفرع');
  });

  it('blocks normal close but exposes the separately-permitted open-order override', () => {
    expect(shiftsPage).toContain('OPEN_ORDERS_BLOCK_SHIFT_CLOSE');
    expect(shiftsPage).toContain("can('shifts.close_with_open_orders')");
    expect(shiftsPage).toContain('api.shifts.closeWithOpenOrders');
    expect(shiftsPage).toContain('إغلاق الوردية مع إبقاء الطلبات المفتوحة');
    expect(shiftsPage).toContain('يمكنك تسويتها أولًا، أو استخدام صلاحية إغلاق الوردية مع إبقاء الطلبات المفتوحة');
  });

  it('shows the safe auto-close policy in branch settings', () => {
    expect(settingsPage).toContain('auto_close_shift_at_day_end');
    expect(settingsPage).toContain('إغلاق الشفت تلقائيًا عند نهاية اليوم المالي');
    expect(settingsPage).toContain('إذا وُجدت طلبات، يبقى الشفت مفتوحًا');
  });

  it('shows the resolved financial-day start and end on the printed report', () => {
    expect(dayReport).toContain('windowStart');
    expect(dayReport).toContain('windowEnd');
    expect(dayReport).toContain('بداية اليوم:');
    expect(dayReport).toContain('نهاية اليوم:');
    expect(dayReport).toContain('أول شفت ← آخر شفت');
  });
});
