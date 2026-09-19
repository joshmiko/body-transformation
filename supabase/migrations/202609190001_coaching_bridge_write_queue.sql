-- Stage the reviewed coach-update write path without changing or rewriting history.
-- This migration is review-only and must not be applied until OAuth/RLS tests pass.

-- Split canonical access: normal app sessions keep existing sync writes; OAuth clients
-- can read their own canonical records but cannot write them directly.
drop policy if exists "users manage own canonical records" on public.user_data_records;
drop policy if exists "direct sessions manage own canonical records" on public.user_data_records;
drop policy if exists "oauth clients read own canonical records" on public.user_data_records;

create policy "direct sessions manage own canonical records"
  on public.user_data_records
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is null
  )
  with check (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is null
  );

create policy "oauth clients read own canonical records"
  on public.user_data_records
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is not null
  );

-- Legacy normalized/staging tables remain available to the app, but all OAuth
-- clients are denied until each table has an explicitly reviewed least-privilege
-- policy. Existing ownership policies continue to protect direct app sessions.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'activity_events',
    'body_checkins',
    'coaching_snapshots',
    'import_records',
    'import_runs',
    'nutrition_logs',
    'profiles',
    'program_days',
    'program_exercises',
    'programs',
    'recovery_checkins',
    'strong_import_rows',
    'workout_exercises',
    'workout_sessions',
    'workout_sets'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'block oauth clients from legacy data', table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select auth.jwt() ->> ''client_id'') is null) with check ((select auth.jwt() ->> ''client_id'') is null)',
      'block oauth clients from legacy data',
      table_name
    );
  end loop;
end
$$;

-- OAuth writes land only in this review queue. They cannot mutate canonical
-- records, workouts, nutrition history, program state, or progress photos.
create table if not exists public.coaching_update_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  schema text not null check (schema = 'body-transformation-coach-update-v1'),
  source_package_id text not null check (char_length(source_package_id) between 1 and 160),
  expected_watermark timestamptz,
  coach_summary text not null check (char_length(coach_summary) between 1 and 4000),
  next_week_program jsonb,
  target_guidance jsonb,
  payload_hash text not null check (char_length(payload_hash) between 8 and 128),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'applied', 'rejected')),
  requested_by_client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  applied_at timestamptz,
  unique (user_id, idempotency_key),
  unique (id, user_id)
);

create index if not exists coaching_update_requests_user_status_idx
  on public.coaching_update_requests (user_id, status, updated_at desc);

create table if not exists public.coaching_update_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('draft_created', 'submitted', 'approved', 'rejected', 'applied')),
  actor_type text not null check (actor_type in ('oauth', 'app')),
  actor_client_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (request_id, user_id)
    references public.coaching_update_requests (id, user_id)
    on delete cascade,
  unique (request_id, event_type, actor_type)
);

create index if not exists coaching_update_audit_user_created_idx
  on public.coaching_update_audit (user_id, created_at desc);

alter table public.coaching_update_requests enable row level security;
alter table public.coaching_update_audit enable row level security;

grant select, insert, update on public.coaching_update_requests to authenticated;
grant select, insert on public.coaching_update_audit to authenticated;

drop trigger if exists coaching_update_requests_set_updated_at on public.coaching_update_requests;
create trigger coaching_update_requests_set_updated_at
  before update on public.coaching_update_requests
  for each row execute procedure public.set_updated_at();

drop policy if exists "direct sessions manage coach update requests" on public.coaching_update_requests;
create policy "direct sessions manage coach update requests"
  on public.coaching_update_requests
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and requested_by_client_id is null
    and (select auth.jwt() ->> 'client_id') is null
  )
  with check (
    (select auth.uid()) = user_id
    and requested_by_client_id is null
    and (select auth.jwt() ->> 'client_id') is null
  );

drop policy if exists "oauth clients read own coach update requests" on public.coaching_update_requests;
create policy "oauth clients read own coach update requests"
  on public.coaching_update_requests
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and requested_by_client_id = (select auth.jwt() ->> 'client_id')
    and (select auth.jwt() ->> 'client_id') is not null
  );

drop policy if exists "oauth clients draft coach updates" on public.coaching_update_requests;
create policy "oauth clients draft coach updates"
  on public.coaching_update_requests
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and requested_by_client_id = (select auth.jwt() ->> 'client_id')
    and (select auth.jwt() ->> 'client_id') is not null
    and status = 'draft'
  );

drop policy if exists "oauth clients submit coach drafts" on public.coaching_update_requests;
create policy "oauth clients submit coach drafts"
  on public.coaching_update_requests
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and requested_by_client_id = (select auth.jwt() ->> 'client_id')
    and (select auth.jwt() ->> 'client_id') is not null
    and status = 'draft'
  )
  with check (
    (select auth.uid()) = user_id
    and requested_by_client_id = (select auth.jwt() ->> 'client_id')
    and (select auth.jwt() ->> 'client_id') is not null
    and status = 'submitted'
  );

-- OAuth clients may only submit an intact draft. This trigger closes the
-- column-update gap that row-level policies cannot express.
create or replace function public.bt_guard_coaching_update_request()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $
begin
  if (select auth.jwt() ->> 'client_id') is not null then
    if old.user_id is distinct from new.user_id
      or old.idempotency_key is distinct from new.idempotency_key
      or old.schema is distinct from new.schema
      or old.source_package_id is distinct from new.source_package_id
      or old.expected_watermark is distinct from new.expected_watermark
      or old.coach_summary is distinct from new.coach_summary
      or old.next_week_program is distinct from new.next_week_program
      or old.target_guidance is distinct from new.target_guidance
      or old.payload_hash is distinct from new.payload_hash
      or old.requested_by_client_id is distinct from new.requested_by_client_id
      or old.created_at is distinct from new.created_at
      or new.status <> 'submitted'
      or old.status <> 'draft'
    then
      raise exception 'OAuth clients may only submit an unchanged coach-update draft';
    end if;
  end if;
  return new;
end
$;

drop trigger if exists coaching_update_requests_guard_oauth on public.coaching_update_requests;
create trigger coaching_update_requests_guard_oauth
  before update on public.coaching_update_requests
  for each row execute procedure public.bt_guard_coaching_update_request();

drop policy if exists "direct sessions read coach update audit" on public.coaching_update_audit;
create policy "direct sessions read coach update audit"
  on public.coaching_update_audit
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is null
  );

drop policy if exists "direct sessions append coach update audit" on public.coaching_update_audit;
create policy "direct sessions append coach update audit"
  on public.coaching_update_audit
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and actor_type = 'app'
    and actor_client_id is null
    and (select auth.jwt() ->> 'client_id') is null
  );

drop policy if exists "oauth clients read coach update audit" on public.coaching_update_audit;
create policy "oauth clients read coach update audit"
  on public.coaching_update_audit
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and actor_client_id = (select auth.jwt() ->> 'client_id')
    and (select auth.jwt() ->> 'client_id') is not null
  );

drop policy if exists "oauth clients append coach update audit" on public.coaching_update_audit;
create policy "oauth clients append coach update audit"
  on public.coaching_update_audit
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and actor_type = 'oauth'
    and actor_client_id = (select auth.jwt() ->> 'client_id')
    and event_type in ('draft_created', 'submitted')
    and (select auth.jwt() ->> 'client_id') is not null
  );
