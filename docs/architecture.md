# Target architecture

## Principles

- PostgreSQL is the system of record; browser storage is only an offline cache.
- Every write is validated, timestamped, attributable to a user, and safe to retry.
- Historical imports are immutable source records linked to normalized workout data.
- Coaching reads a minimal, versioned summary API rather than device-local state.
- Schema changes are delivered as reviewed migrations and backed up before release.

## Recommended foundation

- **Web client:** TypeScript React application with a small, testable domain layer.
- **Backend/data:** Supabase (PostgreSQL, Auth, row-level security, storage, scheduled backups) or an equivalent managed Postgres/Auth deployment.
- **API:** server-side endpoints for authenticated writes, Strong imports, coaching summaries, and sync status.
- **CI:** GitHub Actions runs install, typecheck, lint, unit tests, build, and migration validation for each pull request.

## Core entities

- `users`
- `exercise_catalog` and aliases
- `programs`, `program_days`, `program_exercises`
- `workout_sessions`, `workout_exercises`, `workout_sets`
- `body_checkins`, `recovery_checkins`, `activity_events`, `nutrition_logs`
- `import_sources`, `import_runs`, `import_records` for Strong CSV and future integrations
- `coaching_snapshots`, `coaching_recommendations`

All date/times are stored in UTC, measurements have explicit units, and source/import identifiers make retries idempotent.

## Migration approach

1. Export and preserve the current browser `bt10_db` data before changing the client.
2. Create the schema, migrations, access policies, and backup/restore runbook.
3. Import Strong CSV into raw import records, validate it, then normalize into sessions/exercises/sets without hard-coding the CSV.
4. Rebuild the workout client against the API; retain offline drafts with conflict-safe synchronization.
5. Add a coaching summary endpoint and only then connect an AI coaching workflow.

## GitHub workflow

`main` remains the release branch. Work occurs in short-lived `codex/*` branches through pull requests. A PR must pass CI before merge; releases are tagged, and deployment is driven from the merged commit so every deployed version is reproducible.
