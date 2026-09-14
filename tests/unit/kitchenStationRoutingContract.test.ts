import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('kitchen category routing contract', () => {
  const migrationPath = 'supabase/migrations/20260914151000_kitchen_cashier_and_fallback_guard.sql';

  it('rejects cashier as a kitchen destination', () => {
    const sql = read(migrationPath);
    expect(sql).toContain("v_station_code = 'cashier'");
    expect(sql).toContain('CASHIER_RESERVED_FOR_RECEIPTS');
  });

  it('requires category station configuration before inventory deduction', () => {
    const sql = read(migrationPath);
    expect(sql).toContain('KITCHEN_STATION_NOT_CONFIGURED');
    expect(sql).toContain('pg_temp.kns_delta');
    expect(sql).toContain('LEFT JOIN public.categories c ON c.id = p.category_id AND c.branch_id = v_branch_id');
  });

  it('removes the silent main-station fallback', () => {
    const sql = read(migrationPath);
    expect(sql).toContain("'''station_code'', COALESCE(ks.code, ''main'')'");
    expect(sql).toContain("'''station_code'', ks.code'");
    expect(sql).toContain('SEND_TO_KITCHEN_FALLBACK_STILL_PRESENT');
  });

  it('keeps receipt routing owned by the existing cashier contract', () => {
    const receiptSql = read('supabase/migrations/20260912003000_cloud_print_receipt_retry_idempotency.sql');
    expect(receiptSql).toContain("'receipt', 'cashier'");
  });

  it('keeps kitchen jobs grouped by station code in the web layer', () => {
    const cloudPrint = read('src/features/pos/services/cloudPrint.ts');
    expect(cloudPrint).toContain('Object.entries(groupKitchenItemsByStation(params.items))');
    expect(cloudPrint).toContain('([station, stationItems])');
    expect(cloudPrint).toContain('p_station_code: station');
    expect(cloudPrint).toContain('buildStationTicketText(station, stationItems');
  });
});
