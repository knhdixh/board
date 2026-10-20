-- Only people on the allow-list can use the app (just the owner).
create table public.allowed_users (
  email text primary key check (email = lower(email))
);
alter table public.allowed_users enable row level security; -- no policies: only readable through is_allowed()
-- The owner's address is added outside the repo (it's public):
--   insert into public.allowed_users (email) values ('you@example.com');

create function public.is_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_users where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

drop policy "own boards: select" on public.boards;
drop policy "own boards: insert" on public.boards;
drop policy "own boards: update" on public.boards;
drop policy "own boards: delete" on public.boards;
create policy "owner: select" on public.boards
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed()));
create policy "owner: insert" on public.boards
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_allowed()));
create policy "owner: update" on public.boards
  for update to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed()))
  with check (user_id = (select auth.uid()));
create policy "owner: delete" on public.boards
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.is_allowed()));

-- Keep-alive: free projects pause after a week without activity. A daily cron writes here.
-- One row per source, so pinging can't grow the table.
create table public.heartbeats (
  source text primary key check (source in ('vercel-cron', 'github-actions', 'app')),
  at timestamptz not null default now(),
  count bigint not null default 1
);
alter table public.heartbeats enable row level security;

create function public.heartbeat(source text) returns timestamptz
language sql volatile security definer set search_path = '' as $$
  insert into public.heartbeats as h (source) values (source)
  on conflict (source) do update set at = now(), count = h.count + 1
  returning at
$$;
revoke all on function public.heartbeat(text) from public;
grant execute on function public.heartbeat(text) to anon, authenticated;

-- Transfer the app measures itself, per day (for the usage dashboard).
create table public.usage_daily (
  day date primary key default current_date,
  visits integer not null default 0,
  vercel_bytes bigint not null default 0,
  supabase_bytes bigint not null default 0
);
alter table public.usage_daily enable row level security;

create function public.record_usage(visits integer, vercel_bytes bigint, supabase_bytes bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_allowed() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.usage_daily as u (day, visits, vercel_bytes, supabase_bytes)
  values (current_date, greatest(visits, 0), greatest(vercel_bytes, 0), greatest(supabase_bytes, 0))
  on conflict (day) do update set
    visits = u.visits + excluded.visits,
    vercel_bytes = u.vercel_bytes + excluded.vercel_bytes,
    supabase_bytes = u.supabase_bytes + excluded.supabase_bytes;
  perform public.heartbeat('app');
end $$;
revoke all on function public.record_usage(integer, bigint, bigint) from public, anon;
grant execute on function public.record_usage(integer, bigint, bigint) to authenticated;

-- Everything the dashboard shows, in one call. Owner only.
create function public.usage_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_allowed() then raise exception 'not allowed' using errcode = '42501'; end if;
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'boards_bytes', pg_total_relation_size('public.boards'),
    'boards', (select count(*) from public.boards),
    'scenes_bytes', (select coalesce(sum(octet_length(scene::text)), 0) from public.boards),
    'largest', (select coalesce(jsonb_agg(x), '[]') from (
      select id, title, octet_length(scene::text) as bytes from public.boards order by 3 desc limit 5) x),
    'users', (select count(*) from auth.users),
    'active_users_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'heartbeats', (select coalesce(jsonb_object_agg(source, jsonb_build_object('at', at, 'count', count)), '{}') from public.heartbeats),
    'month', (select jsonb_build_object(
        'visits', coalesce(sum(visits), 0),
        'vercel_bytes', coalesce(sum(vercel_bytes), 0),
        'supabase_bytes', coalesce(sum(supabase_bytes), 0))
      from public.usage_daily where day >= date_trunc('month', current_date)),
    'days', (select coalesce(jsonb_agg(d order by d.day), '[]') from (
      select day, visits, vercel_bytes, supabase_bytes from public.usage_daily
      where day > current_date - 30) d)
  ) into result;
  return result;
end $$;
revoke all on function public.usage_stats() from public, anon;
grant execute on function public.usage_stats() to authenticated;

select public.heartbeat('app');
