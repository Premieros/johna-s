import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260921233000_business_day_rollover_owner_reporting.sql');
const shiftsApi = read('src/api/domains/shifts.ts');
const shiftsPage = read('src/features/trade/pages/ShiftsPage.tsx');
const contract = JSON.parse(read('supabase/api-contract.json')) as {
  rpcs: Array<{ name: string; params: string[] }>;
};

describe('business day rollover + shift owner report contract', () => {
  it('keeps the active shift open while rolling the business day', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.rollover_business_day');
    expect(migration).toContain("'shift_preserved',true");
    expect(migration).toContain("WHERE s.branch_id=p_branch_id AND s.status='open'");
    expect(migration).toContain('SET business_date=v_next_date');
    expect(migration).not.toContain("UPDATE public.shifts\n  SET status='closed'");
  });

  it('uses the persisted active day boundary for live sales, expenses and purchases', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.business_day_state');
    expect(migration).toContain("v_state_date=p_business_date");
    expect(migration).toContain("'active_state',true");
    expect(migration).toContain('AND p.created_at>=v_start');
    expect(migration).toContain('AND p.created_at<=v_end');
  });

  it('attributes shift sales to the order owner and keeps collector audit separate', () => {
    expect(migration).toContain("'user_id',s.cashier_id");
    expect(migration).toContain('LEFT JOIN public.users u ON u.id=s.cashier_id');
    expect(migration).toContain('shift_operations.created_by');
    expect(migration).not.toContain("'user_id',COALESCE(a.created_by,s.cashier_id)");
  });

  it('keeps a continuing shift visible in each rolled day report', () => {
    expect(migration).toContain('AND s.opened_at<=v_end');
    expect(migration).toContain('AND COALESCE(s.closed_at,now())>=v_start');
  });

  it('wires the UI and frontend contract to the current business day', () => {
    expect(shiftsApi).toContain('getCurrentBusinessDay');
    expect(shiftsApi).toContain("'get_current_business_day'");
    expect(shiftsPage).toContain('resolveCurrentBusinessDate');
    expect(shiftsPage).toContain('إغلاق اليوم وبدء يوم جديد مع استمرار الشفت');
    expect(shiftsPage).toContain('printDayReport(closedBusinessDate)');

    const rpc = contract.rpcs.find((x) => x.name === 'get_current_business_day');
    expect(rpc?.params).toEqual(['branch_id']);
  });
});
