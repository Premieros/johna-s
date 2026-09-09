import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('KDS permission-first write boundary', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const viewerUser = randomUUID();
  const writerUser = randomUUID();
  const orderAllowed = randomUUID();
  const orderOtherBranch = randomUUID();
  const orderOtherStation = randomUUID();
  let grillStation = '';
  let saladStation = '';

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(fn: () => Promise<unknown>, message: string): Promise<void> {
    const sp = `sp_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${sp}`);
    let received = '';
    try {
      await fn();
    } catch (error) {
      received = String((error as { message?: string })?.message ?? error);
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    expect(received).toContain(message);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'KDS Permission A'), ($2, 'KDS Permission B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'KDS Viewer', 'cashier', $3, true),
              ($4, $5, 'KDS Writer', 'production_manager', $3, true)`,
      [
        viewerUser,
        `${randomUUID()}@test.local`,
        branchA,
        writerUser,
        `${randomUUID()}@test.local`,
      ],
    );

    // Make the viewer genuinely read-only inside this isolated transaction.
    await client.query(
      `UPDATE public.roles
       SET permissions = (COALESCE(permissions, '[]'::jsonb) - 'pos.kds_update') || '["pos.kds_view"]'::jsonb,
           updated_at = now()
       WHERE role = 'cashier'`,
    );
    await client.query(
      `UPDATE public.roles
       SET permissions = COALESCE(permissions, '[]'::jsonb) || '["pos.kds_view","pos.kds_update"]'::jsonb,
           updated_at = now()
       WHERE role = 'production_manager'`,
    );

    const stations = await client.query<{ id: string; code: string }>(
      `SELECT id, code
       FROM public.kitchen_stations
       WHERE code IN ('grill','salad') AND is_active = true`,
    );
    grillStation = stations.rows.find((row) => row.code === 'grill')?.id ?? '';
    saladStation = stations.rows.find((row) => row.code === 'salad')?.id ?? '';
    expect(grillStation).toBeTruthy();
    expect(saladStation).toBeTruthy();

    await client.query(
      `INSERT INTO public.user_kitchen_station_assignments
         (user_id, branch_id, station_id, created_by)
       VALUES ($1, $2, $3, $1)`,
      [writerUser, branchA, grillStation],
    );

    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, status, kitchen_status, station)
       VALUES ($1, 'KDS-PERM-ALLOWED', $2, 'open', 'sent', 'grill'),
              ($3, 'KDS-PERM-BRANCH', $4, 'open', 'sent', 'grill'),
              ($5, 'KDS-PERM-STATION', $2, 'open', 'sent', 'salad')`,
      [orderAllowed, branchA, orderOtherBranch, branchB, orderOtherStation],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('view-only user can read own-branch KDS but cannot mutate it', async () => {
    await asUser(viewerUser, async () => {
      const queue = await client.query<{ order_id: string }>(
        `SELECT order_id FROM public.get_kitchen_queue(NULL, $1)`,
        [branchA],
      );
      expect(queue.rows.some((row) => row.order_id === orderAllowed)).toBe(true);

      await expectDbError(
        () => client.query(`SELECT public.set_kitchen_status($1, 'cooking')`, [orderAllowed]),
        'PERMISSION_DENIED:pos.kds_update',
      );

      await expectDbError(
        () => client.query(`UPDATE public.orders SET kitchen_status = 'cooking' WHERE id = $1`, [orderAllowed]),
        'PERMISSION_DENIED:pos.kds_update',
      );
    });
  });

  it('writer can update an order inside the assigned branch and station', async () => {
    await asUser(writerUser, async () => {
      await client.query(`SELECT public.set_kitchen_status($1, 'cooking')`, [orderAllowed]);
      const result = await client.query<{ kitchen_status: string }>(
        `SELECT kitchen_status FROM public.orders WHERE id = $1`,
        [orderAllowed],
      );
      expect(result.rows[0]?.kitchen_status).toBe('cooking');
    });
  });

  it('writer cannot update a KDS order from another branch', async () => {
    await asUser(writerUser, async () => {
      await expectDbError(
        () => client.query(`SELECT public.set_kitchen_status($1, 'cooking')`, [orderOtherBranch]),
        'BRANCH_MISMATCH',
      );
    });
  });

  it('writer cannot update an order routed to an unassigned station', async () => {
    await asUser(writerUser, async () => {
      await expectDbError(
        () => client.query(`SELECT public.set_kitchen_status($1, 'cooking')`, [orderOtherStation]),
        'KDS_STATION_ACCESS_DENIED',
      );
    });
  });

  it('server mutation contracts no longer use the KDS read permission for writes', async () => {
    const setStatus = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.set_kitchen_status(uuid,text)'::regprocedure) AS def`,
    );
    expect(setStatus.rows[0].def).toContain("can_permission('pos.kds_update')");
    expect(setStatus.rows[0].def).not.toContain("can_permission('pos.kds_view')");

    const trigger = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure) AS def`,
    );
    expect(trigger.rows[0].def).toContain('pos.kds_update');

    const route = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef('public.route_to_station(uuid,text)'::regprocedure) AS def`,
    );
    expect(route.rows[0].def).toContain('pos.kds_update');
  });
});
