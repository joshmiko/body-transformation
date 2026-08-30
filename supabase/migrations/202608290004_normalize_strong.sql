-- Normalize Strong staging rows into the canonical workout tables.
-- Safe to re-run: sessions are keyed by a deterministic Strong source id.

begin;

do $$
declare
  uid uuid;
begin
  select id into uid from auth.users order by created_at desc limit 1;
  if uid is null then
    raise exception 'No auth user exists; create the app user first';
  end if;

  insert into public.profiles (id)
    values (uid)
    on conflict (id) do nothing;

  update public.strong_import_rows
    set user_id = uid
    where user_id is null;
end $$;

insert into public.exercise_catalog (canonical_name, category, default_load_unit)
select distinct trim("Exercise Name"),
  case
    when lower(trim("Exercise Name")) in ('bike','cycling','cycling (indoor)','walking','running (treadmill)','incline treadmill','rowing (machine)') then 'activity'
    else 'strength'
  end,
  case when max(coalesce(nullif(trim("Seconds"), ''), '0')::numeric) > 0
            and max(coalesce(nullif(trim("Weight"), ''), '0')::numeric) = 0
       then 'seconds' else 'lb' end
from public.strong_import_rows
where trim(coalesce("Exercise Name", '')) <> ''
group by trim("Exercise Name")
on conflict (canonical_name) do nothing;

insert into public.workout_sessions
  (user_id, source, source_record_id, occurred_on, started_at, finished_at, status, notes)
select
  user_id,
  'strong_csv',
  md5(coalesce("Date",'') || '|' || coalesce("Workout Name",'')),
  to_timestamp("Date", 'YYYY-MM-DD HH24:MI:SS')::date,
  to_timestamp("Date", 'YYYY-MM-DD HH24:MI:SS'),
  to_timestamp("Date", 'YYYY-MM-DD HH24:MI:SS')
    + make_interval(mins => coalesce(nullif(regexp_replace(coalesce("Duration",''), '[^0-9]', '', 'g'), '')::integer, 0)),
  'completed',
  max(nullif("Workout Notes",''))
from public.strong_import_rows
where user_id is not null and trim(coalesce("Date",'')) <> ''
group by user_id, "Date", "Workout Name"
on conflict (user_id, source, source_record_id) do nothing;

insert into public.workout_exercises
  (session_id, exercise_id, exercise_name_snapshot, position, notes)
select
  s.id,
  c.id,
  trim(r."Exercise Name"),
  row_number() over (partition by s.id order by min(coalesce(nullif(trim(r."Set Order"),''),'0')::numeric), trim(r."Exercise Name")),
  max(nullif(r."Notes",''))
from public.strong_import_rows r
join public.workout_sessions s
  on s.user_id = r.user_id
 and s.source = 'strong_csv'
 and s.source_record_id = md5(coalesce(r."Date",'') || '|' || coalesce(r."Workout Name",''))
join public.exercise_catalog c on c.canonical_name = trim(r."Exercise Name")
where trim(coalesce(r."Exercise Name",'')) <> ''
  and not exists (
    select 1 from public.workout_exercises e
    where e.session_id = s.id and e.exercise_name_snapshot = trim(r."Exercise Name")
  )
group by s.id, c.id, trim(r."Exercise Name");

insert into public.workout_sets
  (workout_exercise_id, position, kind, weight, weight_unit, reps, completed_at)
select
  e.id,
  coalesce(nullif(trim(r."Set Order"),''),'0')::integer,
  'working',
  nullif(trim(r."Weight"),'')::numeric,
  case
    when coalesce(nullif(trim(r."Seconds"),''),'0')::numeric > 0
     and coalesce(nullif(trim(r."Weight"),''),'0')::numeric = 0
    then 'seconds' else 'lb' end,
  case
    when coalesce(nullif(trim(r."Seconds"),''),'0')::numeric > 0
     and coalesce(nullif(trim(r."Weight"),''),'0')::numeric = 0
    then nullif(trim(r."Seconds"),'')::numeric
    else nullif(trim(r."Reps"),'')::numeric end,
  s.finished_at
from public.strong_import_rows r
join public.workout_sessions s
  on s.user_id = r.user_id
 and s.source = 'strong_csv'
 and s.source_record_id = md5(coalesce(r."Date",'') || '|' || coalesce(r."Workout Name",''))
join public.workout_exercises e
  on e.session_id = s.id
 and e.exercise_name_snapshot = trim(r."Exercise Name")
where nullif(trim(r."Set Order"),'') is not null
  and not exists (
    select 1 from public.workout_sets ws
    where ws.workout_exercise_id = e.id
      and ws.position = nullif(trim(r."Set Order"),'')::integer
      and ws.kind = 'working'
  );

commit;
