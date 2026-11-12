import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, runAs, runAsPersist, type RlsIds } from './rls';
const url = getDbUrl();
const local = Boolean(url) && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('live support candidate — local rollback only', () => {
  let db: pg.Client; let ids: RlsIds; let sessionId: string;
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN'); ids = await seedRlsFixture(db);
    const result = await runAsPersist(db, ids.users.cashier, 'insert into public.live_support_sessions(branch_id,requester_id) values ($1,$2) returning id', [ids.branchA, ids.users.cashier]);
    expect(result.error).toBeUndefined(); sessionId = String(result.rows[0].id);
  });
  afterAll(async () => { if(db) { await db.query('ROLLBACK'); await db.end(); } });
  it('isolates requests across branches and denies unauthorized claims', async () => {
    expect((await runAs(db, ids.users.cashier_b, 'select id from public.live_support_sessions where id=$1', [sessionId])).rowCount).toBe(0);
    const result = await runAs(db, ids.users.cashier_b, "update public.live_support_sessions set operator_id=$1,state='claimed' where id=$2", [ids.users.cashier_b,sessionId]);
    expect(result.rowCount).toBe(0);
  });
  it('refuses participant scope changes and unauthorized self-consent', async () => {
    const scope = await runAs(db, ids.users.cashier, 'update public.live_support_sessions set branch_id=$1 where id=$2', [ids.branchB,sessionId]);
    expect(scope.error).toBeTruthy();
    expect((await runAs(db, ids.users.cashier, "update public.live_support_sessions set state='sharing' where id=$1",[sessionId])).error).toBeTruthy();
  });
  it('allows exactly one permitted operator to claim then only requester to consent', async () => {
    const claim = await runAsPersist(db, ids.users.super_admin, "update public.live_support_sessions set operator_id=$1,state='claimed' where id=$2 returning id",[ids.users.super_admin,sessionId]);
    expect(claim.error).toBeUndefined(); expect(claim.rowCount).toBe(1);
    expect((await runAs(db, ids.users.super_admin, "update public.live_support_sessions set state='sharing' where id=$1",[sessionId])).error).toBeTruthy();
    const consent = await runAsPersist(db, ids.users.cashier, "update public.live_support_sessions set state='sharing' where id=$1",[sessionId]);
    expect(consent.error).toBeUndefined(); expect(consent.rowCount).toBe(1);
  });
  it('keeps signaling private and prevents sender spoofing', async () => {
    const payload = JSON.stringify({type:'ice',candidate:{candidate:'test'}});
    const sent = await runAsPersist(db, ids.users.super_admin, 'insert into public.live_support_signals(session_id,sender_id,payload) values ($1,$2,$3)',[sessionId,ids.users.super_admin,payload]);
    expect(sent.error).toBeUndefined();
    expect((await runAs(db, ids.users.cashier_b, 'select * from public.live_support_signals where session_id=$1',[sessionId])).rowCount).toBe(0);
    expect((await runAs(db, ids.users.cashier, 'select * from public.live_support_signals where session_id=$1',[sessionId])).rowCount).toBe(1);
    expect((await runAs(db, ids.users.cashier, 'insert into public.live_support_signals(session_id,sender_id,payload) values ($1,$2,$3)',[sessionId,ids.users.super_admin,payload])).error).toBeTruthy();
  });
  it('prevents manager-forged employee control consent', async () => {
    expect((await runAs(db,ids.users.super_admin,"insert into public.live_support_events(session_id,actor_id,event) values ($1,$2,'control_granted')",[sessionId,ids.users.super_admin])).error).toBeTruthy();
    const granted = await runAsPersist(db,ids.users.cashier,"insert into public.live_support_events(session_id,actor_id,event) values ($1,$2,'control_granted')",[sessionId,ids.users.cashier]);
    expect(granted.error).toBeUndefined();
  });
  it('revokes signaling after close and prevents reopening', async () => {
    expect((await runAsPersist(db,ids.users.cashier,"update public.live_support_sessions set state='closed' where id=$1",[sessionId])).error).toBeUndefined();
    expect((await runAs(db,ids.users.super_admin,'select * from public.live_support_signals where session_id=$1',[sessionId])).rowCount).toBe(0);
    expect((await runAs(db,ids.users.cashier,"update public.live_support_sessions set state='sharing' where id=$1",[sessionId])).error).toBeTruthy();
  });
});
