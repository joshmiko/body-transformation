-- Progress photos Batch 2: private per-user metadata and Storage ownership.
-- New uploads use paths: <auth user id>/<week start YYYY-MM-DD>/<angle>-<unique>.jpg.
-- The bucket remains private; clients must use authenticated signed URLs or SDK downloads.

create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  captured_on date not null default current_date,
  angle text not null check (angle in ('Front','Side','Back')),
  storage_path text not null,
  mime_type text not null default 'image/jpeg' check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start, angle)
);

create index if not exists progress_photos_user_week_idx
  on public.progress_photos (user_id, week_start);

alter table public.progress_photos enable row level security;

drop policy if exists "users manage own progress photo metadata" on public.progress_photos;
create policy "users manage own progress photo metadata" on public.progress_photos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists progress_photos_set_updated_at on public.progress_photos;
create trigger progress_photos_set_updated_at before update on public.progress_photos
  for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "users read own progress photo files" on storage.objects;
create policy "users read own progress photo files" on storage.objects
  for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "users upload own progress photo files" on storage.objects;
create policy "users upload own progress photo files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "users update own progress photo files" on storage.objects;
create policy "users update own progress photo files" on storage.objects
  for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "users delete own progress photo files" on storage.objects;
create policy "users delete own progress photo files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
