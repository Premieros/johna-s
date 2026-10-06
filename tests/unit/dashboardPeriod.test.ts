import { describe, expect, it } from 'vitest';
import { dashboardPeriod } from '@/features/dashboard/utils/dashboardPeriod';
const dates = { from: '2026-09-01', to: '2026-09-30' };
const now = new Date('2026-10-06T05:00:00Z');
describe('dashboard calendar periods in Cairo', () => {
  it('defaults today to Cairo midnight, includes the whole day and compares yesterday', () => {
    const window = dashboardPeriod('today', dates, now);
    expect(window.from).toBe('2026-10-06');
    expect(window.start.toISOString()).toBe('2026-10-05T21:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-06T20:59:59.999Z');
    expect(window.previousFrom).toBe('2026-10-05');
  });
  it('uses calendar current and previous months across January and leap years', () => {
    const window = dashboardPeriod('previous_month', dates, new Date('2024-03-15T12:00:00Z'));
    expect(window.from).toBe('2024-02-01'); expect(window.to).toBe('2024-02-29'); expect(window.dayCount).toBe(29);
    expect(window.previousFrom).toBe('2024-01-01'); expect(window.previousTo).toBe('2024-01-31');
    expect(dashboardPeriod('previous_month', dates, new Date('2026-01-03T12:00:00Z')).from).toBe('2025-12-01');
    expect(dashboardPeriod('month', dates, now).from).toBe('2026-10-01');
  });
  it('includes custom end day, compares an equal calendar span and rejects invalid dates', () => {
    const window = dashboardPeriod('custom', dates, now);
    expect(window.dayCount).toBe(30); expect(window.previousFrom).toBe('2026-08-02'); expect(window.previousTo).toBe('2026-08-31');
    expect(window.end.toISOString()).toBe('2026-09-30T20:59:59.999Z');
    for (const invalid of [{ from: '', to: '' }, { from: '2026-02-30', to: '2026-03-03' }, { from: '2026-10-06', to: '2026-10-05' }]) expect(() => dashboardPeriod('custom', invalid, now)).toThrow();
  });
  it('keeps calendar day counts correct across Cairo DST', () => {
    const window = dashboardPeriod('custom', { from: '2026-10-29', to: '2026-10-30' }, now);
    expect(window.dayCount).toBe(2);
    expect(window.end.getTime() - window.start.getTime() + 1).toBe(49 * 3600000);
  });
});
