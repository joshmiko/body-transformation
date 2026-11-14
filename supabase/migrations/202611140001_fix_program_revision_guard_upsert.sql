-- Already applied in production as version 20261114144854. This file records that
-- change in the repo. It only replaces a function (create or replace), so it is safe
-- to re-run.
--
-- INSERT ... ON CONFLICT DO UPDATE fires the BEFORE INSERT trigger first, so the
-- insert path must validate against an existing row instead of demanding revision 1.
create or replace function public.guard_program_state_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_payload jsonb;
  old_revision integer;
  new_revision integer;
  row_exists boolean := false;
begin
  if new.record_type <> 'program_state' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_payload := old.payload;
    row_exists := true;
  else
    select payload into old_payload
    from public.user_data_records
    where user_id = new.user_id
      and record_type = new.record_type
      and source_record_id = new.source_record_id;
    row_exists := found;
  end if;

  -- Retried, identical writes are safe even if the first acknowledgement was lost.
  if row_exists and new.payload = old_payload then
    return new;
  end if;

  if coalesce(new.payload->>'revision', '') !~ '^[1-9][0-9]*$' then
    raise exception 'PROGRAM_REVISION_CONFLICT: refresh the current program before editing';
  end if;
  new_revision := (new.payload->>'revision')::integer;

  if row_exists then
    old_revision := coalesce((old_payload->>'revision')::integer, 0);
    if new_revision <> old_revision + 1 then
      raise exception 'PROGRAM_REVISION_CONFLICT: refresh the current program before editing';
    end if;
  elsif new_revision <> 1 then
    raise exception 'PROGRAM_REVISION_CONFLICT: new program must start at revision 1';
  end if;
  return new;
end;
$$;
