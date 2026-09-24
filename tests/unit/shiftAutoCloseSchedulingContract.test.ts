import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settings = readFileSync('src/context/SettingsContext.tsx', 'utf8');
const businessTime = readFileSync('src/lib/businessTime.ts', 'utf8');

describe('shift auto-close scheduling contract', () => {
  it('keeps the existing authoritative auto-close RPC but removes minute polling', () => {
    expect(settings).toContain("supabase.rpc('try_auto_close_branch_shift'");
    expect(settings).not.toContain('window.setInterval(() => { void tick(); }, 60_000)');
    expect(settings).not.toContain('window.clearInterval(timer)');
  });

  it('schedules from the authoritative server cutoff when provided', () => {
    expect(settings).toContain("result?.reason === 'BUSINESS_DAY_NOT_FINISHED'");
    expect(settings).toContain('result.window_end');
    expect(settings).toContain('scheduleAt(row, serverCutoff)');
  });

  it('retries only after open orders block closure and otherwise schedules the next cutoff', () => {
    expect(settings).toContain("result?.error === 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE'");
    expect(settings).toContain('const RETRY_AFTER_BLOCK_MS = 5 * 60_000;');
    expect(settings).toContain('scheduleConfiguredCutoff(row)');
    expect(settings).toContain('nextCairoClockInstant(row.business_day_end)');
  });

  it('uses DST-aware Cairo clock scheduling', () => {
    expect(businessTime).toContain('export function nextCairoClockInstant');
    expect(businessTime).toContain('cairoLocalDateTimeToUtc');
  });
});
