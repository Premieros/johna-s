import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('business day boundaries and single shared branch shift', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('stores per-branch business-day mode and fixed boundary times', async () => {
    const { rows } = await client.query<{ column_name: string; column_default: string | null }>(`
      SELECT column_name,column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='branch_settings'
        AND column_name IN ('business_day_mode','business_day_start','business_day_end','auto_close_shift_at_day_end')
      ORDER BY column_name
    `);
    expect(rows.map((r) => r.column_name)).toEqual([
      'auto_close_shift_at_day_end',
      'business_day_end',
      'business_day_mode',
      'business_day_start',
    ]);

    const mode = await client.query<{ def: string }>(`
      SELECT pg_get_constraintdef(oid) def
      FROM pg_constraint
      WHERE conrelid='public.branch_settings'::regclass
        AND conname='branch_settings_business_day_mode_check'
    `);
    expect(mode.rows[0].def).toContain('fixed_time');
    expect(mode.rows[0].def).toContain('shift_span');
  });

  it('resolves fixed time across midnight and shift-span from first open through last close', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public._resolve_business_day_window(uuid,date)'::regprocedure) def
    `);
    const def = rows[0].def.replace(/\s+/g, ' ');
    expect(def).toContain("v_mode='shift_span'");
    expect(def).toContain("min(s.opened_at)");
    expect(def).toContain("max(COALESCE(s.closed_at,now()))");
    expect(def).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(def).toContain("v_nominal_start");
    expect(def).toContain("v_nominal_next");
    expect(def).toContain("s.opened_at>=v_nominal_start");
    expect(def).toContain("s.opened_at<v_nominal_next");
  });

  it('uses the resolved window for sales, expenses and cash purchases', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public._build_day_closing_report(uuid,date)'::regprocedure) def
    `);
    const def = rows[0].def.replace(/\s+/g, ' ');
    expect(def).toContain('public._resolve_business_day_window');
    expect(def).toContain('s.created_at>=v_start');
    expect(def).toContain('e.created_at>=v_start');
    expect(def).toContain('p.created_at>=v_start');
    expect(def).toContain('public.sale_payments');
    expect(def).toContain('sp.refunded_amount');
    expect(def).toContain("'business_day_mode'");
    expect(def).toContain("'window_start'");
    expect(def).toContain("'window_end'");
  });

  it('blocks manual day close while a shift is open but does not require waiting for configured auto-close time', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public._finalize_day_close(uuid,date,uuid)'::regprocedure) def
    `);
    const def = rows[0].def;
    expect(def).toContain("'OPEN_SHIFTS_REMAIN'");
    expect(def).toContain("'NO_SHIFTS_FOR_DAY'");
    expect(def).not.toContain("'BUSINESS_DAY_NOT_FINISHED'");
  });

  it('auto-close uses the configured cutoff instead of the live report end', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public.try_auto_close_branch_shift(uuid)'::regprocedure) def
    `);
    const def = rows[0].def.replace(/\s+/g, ' ');
    expect(def).toContain('public._ensure_business_day_state');
    expect(def).toContain("v_end_time<=v_start_time");
    expect(def).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(def).toContain('WHILE v_window_end<=v_shift.opened_at LOOP');
    expect(def).toContain("'BUSINESS_DAY_NOT_FINISHED'");
    expect(def).not.toContain('public._resolve_business_day_window');
  });

  it('auto-close never bypasses open orders and never fakes an actual cash count', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public.try_auto_close_branch_shift(uuid)'::regprocedure) def
    `);
    const def = rows[0].def.replace(/\s+/g, ' ');
    expect(def).toContain("'OPEN_ORDERS_BLOCK_SHIFT_CLOSE'");
    expect(def).toContain("actual_amount=NULL");
    expect(def).toContain("difference=NULL");
    expect(def).toContain("AUTO_CLOSED_AT_BUSINESS_DAY_END");
  });

  it('retains a separate Permission-First override that preserves operational orders', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public.close_shift_with_open_orders(uuid,numeric,text)'::regprocedure) def
    `);
    const def = rows[0].def.replace(/\s+/g, ' ');
    expect(def).toContain("can_permission('shifts.close')");
    expect(def).toContain("can_permission('shifts.close_with_open_orders')");
    expect(def).toContain("SET status='closed'");
    expect(def).toContain("'open_orders_preserved'");
    expect(def).not.toMatch(/UPDATE\s+public\.orders/i);
    expect(def).not.toMatch(/UPDATE\s+public\.dining_tables/i);
  });

  it('still enforces exactly one open shared shift per branch', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_constraintdef(oid) def
      FROM pg_constraint
      WHERE conrelid='public.shifts'::regclass
        AND conname='uq_shifts_one_open_per_branch_deferred'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('UNIQUE');
    expect(rows[0].def).toContain('branch_id');
    expect(rows[0].def).toContain('open_branch_guard');
  });
});
