import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const targets = [
  ['activate_subscription', 'p_branch_id uuid, p_plan_id text, p_billing_period text, p_activate boolean'],
  [
    'subscription_settings_update',
    'p_instapay_id text, p_beneficiary_name text, p_qr_code_url text, p_instructions_ar text, p_instructions_en text, p_trial_days integer, p_warning_days integer, p_grace_days integer, p_require_receipt boolean, p_allow_monthly boolean, p_allow_yearly boolean',
  ],
  [
    'super_admin_change_subscription',
    'p_tenant_id uuid, p_plan_id uuid, p_status text, p_current_period_end timestamp with time zone, p_trial_ends_at timestamp with time zone',
  ],
] as const;

describe.skipIf(!dbUrl)('subscription admin SECURITY DEFINER hardening', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('uses public, pg_temp search_path and authenticated-only execute', async () => {
    for (const [name, args] of targets) {
      const row = await client.query<{
        config: string[] | null;
        authenticated_execute: boolean;
        anon_execute: boolean;
      }>(
        `SELECT p.proconfig AS config,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = $1
           AND pg_get_function_identity_arguments(p.oid) = $2`,
        [name, args],
      );

      expect(row.rows, `${name}(${args})`).toHaveLength(1);
      expect(row.rows[0].config ?? [], `${name} search_path`).toContain('search_path=public, pg_temp');
      expect(row.rows[0].authenticated_execute, `${name} authenticated execute`).toBe(true);
      expect(row.rows[0].anon_execute, `${name} anon execute`).toBe(false);
    }
  });

  it('preserves the existing Super Admin authorization guards', async () => {
    const rows = await client.query<{ name: string; definition: string }>(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [['activate_subscription', 'subscription_settings_update', 'super_admin_change_subscription']],
    );

    const byName = new Map(rows.rows.map((row) => [row.name, row.definition]));

    for (const name of ['activate_subscription', 'subscription_settings_update', 'super_admin_change_subscription']) {
      expect(byName.get(name), `${name} guard`).toMatch(/(?:public\.)?is_super_admin\(\)/);
    }
  });
});
