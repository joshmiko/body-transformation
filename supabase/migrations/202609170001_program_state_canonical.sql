-- Add a forward-compatible canonical record for the current/future program.
-- Existing workout payloads retain their immutable programSnapshot values.
-- This migration is intentionally not applied by this review-only release.
alter table if exists public.user_data_records
  drop constraint if exists user_data_records_record_type_check;

alter table if exists public.user_data_records
  add constraint user_data_records_record_type_check check (
    record_type in (
      'workout_session',
      'checkin',
      'nutrition_entry',
      'nutrition_summary',
      'nutrition_target',
      'recovery_activity',
      'coaching_state',
      'program_state'
    )
  );
