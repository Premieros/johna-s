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

  it('requires every open order to be resolved before shift close', () => {
    expect(shiftsPage).toContain('لا يمكن إغلاق الوردية مع وجود طلبات مفتوحة');
    expect(shiftsPage).toContain('يجب على المستخدم إغلاق أو تسوية كل الطلبات أولًا');
    expect(shiftsPage).not.toContain('إغلاق الوردية مع بقاء الطلبات المفتوحة');
    expect(shiftsPage).not.toContain('Close Shift With Open Orders');
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
