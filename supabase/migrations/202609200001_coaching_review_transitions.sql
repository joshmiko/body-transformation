-- Review-gated transitions for OAuth-created coach updates.
-- Apply only after the authenticated two-user round-trip passes.

alter table public.coaching_update_requests
  add column if not exists request_version bigint not null default 1;

create or replace function public.bt_guard_coaching_update_request()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
      or new.request_version <> old.request_version + 1
      or new.status <> 'submitted'
      or old.status <> 'draft'
    then
      raise exception 'OAuth clients may only submit an unchanged coach-update draft';
    end if;
  else
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
      or old.submitted_at is distinct from new.submitted_at
      or new.request_version <> old.request_version + 1
    then
      raise exception 'Coach-update proposal is immutable after submission';
    end if;

    if old.status = 'submitted' and new.status not in ('approved', 'rejected') then
      raise exception 'Coach updates may only move submitted to approved or rejected';
    end if;
    if old.status = 'approved' and new.status <> 'applied' then
      raise exception 'Approved coach updates may only move to applied';
    end if;
    if old.status in ('rejected', 'applied') then
      raise exception 'Final coach-update states cannot be changed';
    end if;
    if new.status in ('approved', 'rejected') and new.reviewed_at is null then
      raise exception 'Reviewed coach updates require reviewed_at';
    end if;
    if new.status = 'applied' and new.applied_at is null then
      raise exception 'Applied coach updates require applied_at';
    end if;
  end if;
  return new;
end
$$;

drop policy if exists "direct sessions manage coach update requests" on public.coaching_update_requests;

create policy "direct sessions read coach update requests"
  on public.coaching_update_requests
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is null
  );

create policy "direct sessions review coach update requests"
  on public.coaching_update_requests
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is null
    and status in ('submitted', 'approved')
  )
  with check (
    (select auth.uid()) = user_id
    and (select auth.jwt() ->> 'client_id') is null
    and status in ('approved', 'rejected', 'applied')
  );
