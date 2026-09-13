-- Canonical per-user sync records for cross-device/offline rehydration.
-- Payloads retain the app's complete local records so new fields remain forward-compatible.

create table if not exists public.user_data_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in (
    'workout_session',
    'checkin',
    'nutrition_entry',
    'nutrition_summary',
    'nutrition_target',
    'recovery_activity',
    'coaching_state'
  )),
  source_record_id text not null,
  occurred_on date,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, record_type, source_record_id)
);

create index if not exists user_data_records_user_type_date_idx
  on public.user_data_records (user_id, record_type, occurred_on);

alter table public.user_data_records enable row level security;

drop policy if exists "users manage own canonical records" on public.user_data_records;
create policy "users manage own canonical records" on public.user_data_records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists user_data_records_set_updated_at on public.user_data_records;
create trigger user_data_records_set_updated_at before update on public.user_data_records
  for each row execute procedure public.set_updated_at();
