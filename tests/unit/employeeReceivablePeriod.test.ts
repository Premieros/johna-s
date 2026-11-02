import { describe, expect, it } from 'vitest';
import {
  createCurrentMonthEmployeeReceivablePeriod,
  getCairoToday,
  getEmployeeReceivableMinimumDate,
  isValidEmployeeReceivablePeriod,
} from '@/features/accounting/services/employeeReceivablePeriod';

describe('employee receivables main-screen period filter', () => {
  it('defaults to the current Cairo month through today', () => {
    expect(createCurrentMonthEmployeeReceivablePeriod('2026-11-02', '2026-09-16')).toEqual({
      from: '2026-11-01',
      to: '2026-11-02',
    });
  });

  it('respects the existing seven-day history visibility boundary', () => {
    expect(getEmployeeReceivableMinimumDate('2026-11-02', '2026-09-16', false)).toBe('2026-10-27');
    expect(createCurrentMonthEmployeeReceivablePeriod('2026-11-02', '2026-10-27')).toEqual({
      from: '2026-10-27',
      to: '2026-11-02',
    });
  });

  it('allows the approved opening date when full history permission exists', () => {
    expect(getEmployeeReceivableMinimumDate('2026-11-02', '2026-09-16', true)).toBe('2026-09-16');
  });

  it('validates inclusive custom ranges and rejects reversed, future or restricted dates', () => {
    const minimumDate = '2026-10-27';
    const today = '2026-11-02';
    expect(isValidEmployeeReceivablePeriod({ from: '2026-10-29', to: '2026-11-02' }, minimumDate, today)).toBe(true);
    expect(isValidEmployeeReceivablePeriod({ from: '2026-10-26', to: '2026-11-02' }, minimumDate, today)).toBe(false);
    expect(isValidEmployeeReceivablePeriod({ from: '2026-11-02', to: '2026-11-01' }, minimumDate, today)).toBe(false);
    expect(isValidEmployeeReceivablePeriod({ from: '2026-11-01', to: '2026-11-03' }, minimumDate, today)).toBe(false);
  });

  it('uses the Africa/Cairo calendar date rather than the runtime UTC date', () => {
    expect(getCairoToday(new Date('2026-11-01T22:30:00.000Z'))).toBe('2026-11-02');
  });
});
