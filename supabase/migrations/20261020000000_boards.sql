-- One row per board. The Excalidraw scene (elements, app state, files) lives in `scene`.
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'untitled' check (char_length(title) <= 200),
  scene jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index boards_user_updated on public.boards (user_id, updated_at desc);

alter table public.boards enable row level security;

create policy "own boards: select" on public.boards
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own boards: insert" on public.boards
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own boards: update" on public.boards
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own boards: delete" on public.boards
  for delete to authenticated using (user_id = (select auth.uid()));

-- Bump version and updated_at on every write, so two devices can't silently overwrite each other.
create function public.boards_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create trigger boards_touch before update on public.boards
  for each row execute function public.boards_touch();

revoke all on public.boards from anon;
