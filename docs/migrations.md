# Data migration discipline

## Supabase migrations

- Store migrations in `supabase/migrations`.
- Name files `YYYYMMDDNNNN_short_description.sql`.
- Add a new migration for every schema or policy change.
- Never modify a migration that may have run in any environment.
- Prefer additive, forward-compatible changes.
- Make retries safe with guards such as `if exists` / `if not exists` where appropriate.
- Separate destructive cleanup into a later release after compatibility is proven.
- Review row-level security and ownership for every new table or policy.

## Browser data migrations

The current PWA has legacy browser data under `bt10_db`. Browser migrations must:

1. detect the source schema/version;
2. clone or preserve the source before transformation;
3. be safe to run more than once;
4. retain unknown fields;
5. preserve workout timestamps and immutable program snapshots;
6. distinguish unknown values from real zero values;
7. fail without replacing the last readable copy;
8. include a representative legacy fixture test.

## Migration pull-request evidence

Include the source and target versions, fixture/test result, rollback or forward-repair strategy, backup requirement, and confirmation that current and historical sessions remain readable.

Database rollback is not coupled to code rollback. Prefer forward repair so records created by a newer release are not lost.
