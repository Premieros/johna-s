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
    expect(settingsPage).toContain('من أول شفت مفتوح إلى آخر شفت مغلق');
  });

  it('does not offer opening another shift when the target branch already has one', () => {
    expect(shiftsPage).toContain('targetOpenShift');
    expect(shiftsPage).toContain("can('shifts.open') && !targetOpenShift");
    expect(shiftsPage).toContain('يوجد شفت مفتوح بالفعل لهذا الفرع');
  });

  it('shows the resolved financial-day start and end on the printed report', () => {
    expect(dayReport).toContain('windowStart');
    expect(dayReport).toContain('windowEnd');
    expect(dayReport).toContain('بداية اليوم:');
    expect(dayReport).toContain('نهاية اليوم:');
    expect(dayReport).toContain('أول شفت ← آخر شفت');
  });
});
