-- Per-user preferences that should follow you between devices: saved note styles, the style for new notes.
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) < 100000),
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
create policy "owner: all" on public.settings
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.is_allowed()));
revoke all on public.settings from anon;
