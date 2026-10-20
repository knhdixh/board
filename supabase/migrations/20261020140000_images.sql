-- Images dropped onto a board live in Storage, not in the board's JSON, so saves stay small.
-- Path: <user id>/<file id>. Excalidraw's file id is a hash of the image, so the same image is stored once.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', false, 10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/x-icon', 'image/avif', 'image/jfif'])
on conflict (id) do nothing;

create policy "owner images: select" on storage.objects
  for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_allowed()));
create policy "owner images: insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_allowed()));
create policy "owner images: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_allowed()));
