-- Temporary, auditable landing table for Strong CSV imports.
-- Rows are normalized into workout_sessions/workout_exercises/workout_sets after validation.

create table if not exists public.strong_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid references public.import_runs(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  source_row_number bigint generated always as identity,
  date_text text not null,
  workout_name text,
  duration_text text,
  exercise_name text not null,
  set_order_text text,
  weight_text text,
  reps_text text,
  distance_text text,
  seconds_text text,
  notes text,
  workout_notes text,
  rpe_text text,
  loaded_at timestamptz not null default now(),
  unique (import_run_id, source_row_number)
);

alter table public.strong_import_rows enable row level security;

drop policy if exists "users manage own strong staging" on public.strong_import_rows;
create policy "users manage own strong staging" on public.strong_import_rows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists strong_import_rows_run_idx
  on public.strong_import_rows (import_run_id, source_row_number);
