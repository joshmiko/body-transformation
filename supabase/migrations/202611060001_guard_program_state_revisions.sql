-- A Coach-approved program must not be replaced by an older browser cache.
-- Existing records receive a revision without changing their training data.
update public.user_data_records
set payload = jsonb_set(payload, '{revision}', '1'::jsonb, true)
where record_type = 'program_state' and not (payload ? 'revision');

create or replace function public.guard_program_state_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_revision integer;
  new_revision integer;
begin
  if new.record_type <> 'program_state' then
    return new;
  end if;

  -- Retried, identical writes are safe even if the first acknowledgement was lost.
  if tg_op = 'UPDATE' and new.payload = old.payload then
    return new;
  end if;

  if coalesce(new.payload->>'revision', '') !~ '^[1-9][0-9]*$' then
    raise exception 'PROGRAM_REVISION_CONFLICT: refresh the current program before editing';
  end if;
  new_revision := (new.payload->>'revision')::integer;
  if tg_op = 'UPDATE' then
    old_revision := coalesce((old.payload->>'revision')::integer, 0);
    if new_revision <> old_revision + 1 then
      raise exception 'PROGRAM_REVISION_CONFLICT: refresh the current program before editing';
    end if;
  elsif new_revision <> 1 then
    raise exception 'PROGRAM_REVISION_CONFLICT: new program must start at revision 1';
  end if;
  return new;
end;
$$;

drop trigger if exists user_data_records_guard_program_revision on public.user_data_records;
create trigger user_data_records_guard_program_revision
  before insert or update on public.user_data_records
  for each row when (new.record_type = 'program_state')
  execute function public.guard_program_state_revision();
