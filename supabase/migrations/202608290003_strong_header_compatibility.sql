-- Compatibility columns allow the Strong export to be uploaded unchanged.
-- The normalization step will read these source columns and validate their values.

alter table public.strong_import_rows
  add column if not exists "Date" text,
  add column if not exists "Workout Name" text,
  add column if not exists "Duration" text,
  add column if not exists "Exercise Name" text,
  add column if not exists "Set Order" text,
  add column if not exists "Weight" text,
  add column if not exists "Reps" text,
  add column if not exists "Distance" text,
  add column if not exists "Seconds" text,
  add column if not exists "Notes" text,
  add column if not exists "Workout Notes" text,
  add column if not exists "RPE" text;
