-- Body Transformation: initial data-first schema.
-- Apply through the Supabase SQL editor or Supabase CLI before connecting the client.

create extension if not exists pgcrypto;

do $ begin
  create type public.session_status as enum ('draft', 'in_progress', 'completed', 'abandoned');
exception when duplicate_object then null;
end $;
do $ begin
  create type public.set_kind as enum ('warmup', 'working');
exception when duplicate_object then null;
end $;
do $ begin
  create type public.import_status as enum ('started', 'validated', 'completed', 'failed');
exception when duplicate_object then null;
end $;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_weight_unit text not null default 'lb' check (preferred_weight_unit in ('lb', 'kg')),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  category text,
  default_load_unit text not null default 'lb' check (default_load_unit in ('lb', 'kg', 'bodyweight', 'seconds')),
  created_at timestamptz not null default now()
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists one_active_program_per_user
  on public.programs (user_id) where is_active;

create table if not exists public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  title text not null,
  focus text,
  position smallint not null default 0
);

create table if not exists public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references public.program_days(id) on delete cascade,
  exercise_id uuid not null references public.exercise_catalog(id),
  position smallint not null,
  target_sets smallint not null check (target_sets > 0),
  min_reps smallint check (min_reps > 0),
  max_reps smallint check (max_reps >= min_reps),
  rest_seconds integer check (rest_seconds >= 0),
  notes text
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  program_day_id uuid references public.program_days(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'strong_csv', 'strong_sync', 'migration')),
  source_record_id text,
  occurred_on date not null,
  started_at timestamptz,
  finished_at timestamptz,
  status public.session_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create unique index if not exists workout_source_idempotency
  on public.workout_sessions (user_id, source, source_record_id)
  where source_record_id is not null;

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid references public.exercise_catalog(id),
  exercise_name_snapshot text not null,
  position smallint not null,
  planned_sets smallint check (planned_sets > 0),
  min_reps smallint check (min_reps > 0),
  max_reps smallint check (max_reps >= min_reps),
  notes text
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  position smallint not null check (position > 0),
  kind public.set_kind not null default 'working',
  weight numeric(8,2) check (weight >= 0),
  weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg', 'bodyweight', 'seconds')),
  reps numeric(6,2) check (reps >= 0),
  perceived_effort smallint check (perceived_effort between 1 and 10),
  feel text check (feel in ('easy', 'good', 'hard')),
  completed_at timestamptz,
  unique (workout_exercise_id, position, kind)
);

create table if not exists public.body_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  weight numeric(8,2) check (weight > 0),
  weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg')),
  waist numeric(8,2) check (waist > 0),
  waist_unit text check (waist_unit in ('in', 'cm')),
  body_fat_percent numeric(5,2) check (body_fat_percent between 0 and 100),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.recovery_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  sleep_hours numeric(4,2) check (sleep_hours between 0 and 24),
  soreness smallint check (soreness between 1 and 10),
  fatigue smallint check (fatigue between 1 and 10),
  stress smallint check (stress between 1 and 10),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null,
  activity_type text not null,
  duration_minutes integer check (duration_minutes > 0),
  intensity smallint check (intensity between 1 and 10),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recorded_on date not null,
  calories integer check (calories >= 0),
  protein_grams numeric(7,2) check (protein_grams >= 0),
  adherence smallint check (adherence between 1 and 10),
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, recorded_on)
);

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  source_file_name text,
  source_checksum text,
  status public.import_status not null default 'started',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, source, source_checksum)
);

create table if not exists public.import_records (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
  raw_record jsonb not null,
  normalized_session_id uuid references public.workout_sessions(id) on delete set null,
  validation_errors jsonb not null default '[]'::jsonb,
  unique (import_run_id, source_row_number)
);

create table if not exists public.coaching_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  data_version text not null default 'v1',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
drop trigger if exists workout_sessions_set_updated_at on public.workout_sessions;
create trigger workout_sessions_set_updated_at before update on public.workout_sessions
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.program_days enable row level security;
alter table public.program_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_checkins enable row level security;
alter table public.recovery_checkins enable row level security;
alter table public.activity_events enable row level security;
alter table public.nutrition_logs enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_records enable row level security;
alter table public.coaching_snapshots enable row level security;

drop policy if exists "profiles are private" on public.profiles;
create policy "profiles are private" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "users manage programs" on public.programs;
create policy "users manage programs" on public.programs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage program days" on public.program_days;
create policy "users manage program days" on public.program_days
  for all using (exists (select 1 from public.programs p where p.id = program_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.programs p where p.id = program_id and p.user_id = auth.uid()));
drop policy if exists "users manage program exercises" on public.program_exercises;
create policy "users manage program exercises" on public.program_exercises
  for all using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id where d.id = program_day_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id where d.id = program_day_id and p.user_id = auth.uid()));

drop policy if exists "users manage own sessions" on public.workout_sessions;
create policy "users manage own sessions" on public.workout_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own workout exercises" on public.workout_exercises;
create policy "users manage own workout exercises" on public.workout_exercises
  for all using (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
drop policy if exists "users manage own workout sets" on public.workout_sets;
create policy "users manage own workout sets" on public.workout_sets
  for all using (exists (select 1 from public.workout_exercises e join public.workout_sessions s on s.id = e.session_id where e.id = workout_exercise_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.workout_exercises e join public.workout_sessions s on s.id = e.session_id where e.id = workout_exercise_id and s.user_id = auth.uid()));

drop policy if exists "users manage own body checkins" on public.body_checkins;
create policy "users manage own body checkins" on public.body_checkins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own recovery checkins" on public.recovery_checkins;
create policy "users manage own recovery checkins" on public.recovery_checkins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own activity" on public.activity_events;
create policy "users manage own activity" on public.activity_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own nutrition" on public.nutrition_logs;
create policy "users manage own nutrition" on public.nutrition_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own imports" on public.import_runs;
create policy "users manage own imports" on public.import_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own import records" on public.import_records;
create policy "users manage own import records" on public.import_records
  for all using (exists (select 1 from public.import_runs r where r.id = import_run_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.import_runs r where r.id = import_run_id and r.user_id = auth.uid()));
drop policy if exists "users manage own coaching snapshots" on public.coaching_snapshots;
create policy "users manage own coaching snapshots" on public.coaching_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.exercise_catalog enable row level security;
drop policy if exists "authenticated users read exercises" on public.exercise_catalog;
create policy "authenticated users read exercises" on public.exercise_catalog
  for select using (auth.role() = 'authenticated');
