-- STAGED migration: fresh CI only until separate production approval.
-- No existing operational table, function, trigger or RLS is replaced.
create table public.live_support_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  requester_id uuid not null references public.users(id),
  operator_id uuid references public.users(id),
  requester_name text not null default '',
  branch_name text not null default '',
  operator_name text,
  state text not null default 'waiting' check (state in ('waiting','claimed','sharing','closed')),
  closed_at timestamptz,
  closed_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '20 minutes',
  check (operator_id is null or operator_id <> requester_id)
);
create index live_support_waiting on public.live_support_sessions(branch_id, created_at desc) where state <> 'closed';
create table public.live_support_signals (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.live_support_sessions(id),
  sender_id uuid not null references public.users(id),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536 and payload->>'type' in ('offer','answer','ice')),
  created_at timestamptz not null default now()
);
create index live_support_signal_cursor on public.live_support_signals(session_id,id);
create table public.live_support_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.live_support_sessions(id),
  actor_id uuid not null references public.users(id),
  event text not null check (event in ('view_granted','control_requested','control_granted','control_revoked','ended')),
  created_at timestamptz not null default now()
);
create index live_support_event_history on public.live_support_events(session_id,id);
alter table public.live_support_sessions enable row level security;
alter table public.live_support_signals enable row level security;
alter table public.live_support_events enable row level security;
revoke all on public.live_support_sessions,public.live_support_signals,public.live_support_events from public,anon;
grant select,insert,update on public.live_support_sessions to authenticated;
grant select,insert on public.live_support_signals,public.live_support_events to authenticated;
grant usage on sequence public.live_support_signals_id_seq,public.live_support_events_id_seq to authenticated;

create policy support_session_read on public.live_support_sessions for select to authenticated using (
  public.user_may_access_branch(branch_id) and exists (select 1 from public.users u where u.id=auth.uid() and u.is_active)
  and (requester_id=auth.uid() or (public.can_permission('support.manage') and (operator_id is null or operator_id=auth.uid())))
);
create policy support_session_insert on public.live_support_sessions for insert to authenticated with check (
  requester_id=auth.uid() and operator_id is null and state='waiting' and public.user_may_access_branch(branch_id)
  and exists (select 1 from public.users u where u.id=auth.uid() and u.is_active)
);
create policy support_session_update on public.live_support_sessions for update to authenticated
  using (public.user_may_access_branch(branch_id) and (requester_id=auth.uid() or (public.can_permission('support.manage') and (operator_id is null or operator_id=auth.uid()))))
  with check (public.user_may_access_branch(branch_id) and (requester_id=auth.uid() or (public.can_permission('support.manage') and operator_id=auth.uid())));

create function public.guard_live_support_session() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.users where id=auth.uid() and is_active) then raise exception 'ACTIVE_USER_REQUIRED'; end if;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('live-support:' || auth.uid()::text,0));
    if exists(select 1 from public.live_support_sessions where requester_id=auth.uid() and state<>'closed' and expires_at>now()) then raise exception 'SUPPORT_ALREADY_OPEN'; end if;
    new.requester_id:=auth.uid(); new.operator_id:=null; new.state:='waiting'; new.closed_at:=null; new.closed_by:=null;
    select coalesce(full_name,username,id::text) into new.requester_name from public.users where id=auth.uid();
    select name into new.branch_name from public.branches where id=new.branch_id;
    new.operator_name:=null;
    new.created_at:=now(); new.expires_at:=now()+interval '20 minutes';
  else
    if new.id<>old.id or new.branch_id<>old.branch_id or new.requester_id<>old.requester_id or new.created_at<>old.created_at or new.expires_at<>old.expires_at then raise exception 'IMMUTABLE_SESSION_SCOPE'; end if;
    if new.requester_name<>old.requester_name or new.branch_name<>old.branch_name then raise exception 'IMMUTABLE_SUPPORT_IDENTITY'; end if;
    if old.state='closed' then raise exception 'SESSION_CLOSED'; end if;
    if new.state='closed' and new.operator_id is not distinct from old.operator_id and (auth.uid()=old.requester_id or (auth.uid()=old.operator_id and public.can_permission('support.manage'))) then new.operator_name:=old.operator_name; new.closed_at:=clock_timestamp(); new.closed_by:=auth.uid(); return new; end if;
    if new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by then raise exception 'IMMUTABLE_CLOSE_AUDIT'; end if;
    if old.expires_at<=now() then raise exception 'SESSION_EXPIRED'; end if;
    if auth.uid()=old.requester_id then
      new.operator_name:=old.operator_name;
      if not (old.state='claimed' and new.state='sharing' and old.operator_id is not null and new.operator_id=old.operator_id) then raise exception 'INVALID_REQUESTER_TRANSITION'; end if;
    else
      if not (public.can_permission('support.manage') and old.state='waiting' and old.operator_id is null and new.operator_id=auth.uid() and new.state='claimed') then raise exception 'INVALID_SUPPORT_CLAIM'; end if;
      select coalesce(full_name,username,id::text) into new.operator_name from public.users where id=auth.uid();
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_live_support_session() from public,anon;
create trigger guard_live_support_session before insert or update on public.live_support_sessions for each row execute function public.guard_live_support_session();

create policy support_signals_read on public.live_support_signals for select to authenticated using (
  exists(select 1 from public.live_support_sessions s where s.id=session_id and s.state in ('claimed','sharing') and s.expires_at>now() and (s.requester_id=auth.uid() or s.operator_id=auth.uid()))
);
create policy support_signals_insert on public.live_support_signals for insert to authenticated with check (
  sender_id=auth.uid() and exists(select 1 from public.live_support_sessions s where s.id=session_id and s.state in ('claimed','sharing') and s.expires_at>now() and (s.requester_id=auth.uid() or s.operator_id=auth.uid()))
);
create policy support_events_read on public.live_support_events for select to authenticated using (
  exists(select 1 from public.live_support_sessions s where s.id=session_id and (s.requester_id=auth.uid() or s.operator_id=auth.uid()))
);
create policy support_events_insert on public.live_support_events for insert to authenticated with check (
  actor_id=auth.uid() and exists(select 1 from public.live_support_sessions s where s.id=session_id and s.expires_at>now() and s.state in ('claimed','sharing') and (
    (s.requester_id=auth.uid() and event in ('view_granted','control_granted','control_revoked','ended')) or (s.operator_id=auth.uid() and event in ('control_requested','ended'))
  ))
);
-- Server timestamps make the audit trail independent of browser clocks.
create function public.stamp_live_support_record() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  new.created_at:=clock_timestamp();
  return new;
end $$;
revoke all on function public.stamp_live_support_record() from public,anon;
create trigger stamp_live_support_signal before insert on public.live_support_signals for each row execute function public.stamp_live_support_record();
create trigger stamp_live_support_event before insert on public.live_support_events for each row execute function public.stamp_live_support_record();
