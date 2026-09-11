# Free Supabase setup

Create one free Supabase project for this repository. Choose a region close to you and use a strong database password.

After creation, provide the project URL and **anon/publishable key** only. Never commit a service-role key or database password.

## Required dashboard actions

1. In Authentication, enable email sign-in (or another chosen sign-in method).
2. In SQL Editor, run the migrations in order: `supabase/migrations/202608290001_initial_schema.sql`, then `supabase/migrations/202609060002_progress_photos.sql` for private progress-photo storage. The second migration creates a private bucket and per-user RLS policies; never make that bucket public.
3. Configure the daily keep-alive workflow below; free projects can pause after inactivity.
4. Before importing real training history, export your existing browser data and retain the CSV source file separately.

## GitHub configuration

For a deployed web app, add these repository secrets in GitHub after the project exists:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are public client configuration values, but storing them as deployment secrets keeps environments explicit. Do not add database passwords or Supabase service-role keys to browser code, commits, or GitHub Actions.

## Daily keep-alive

The workflow `.github/workflows/supabase-keep-alive.yml` runs daily at 12:17 UTC and supports **Actions → Keep Supabase Active → Run workflow** after it is merged into `main`.

Add these **repository** secrets under **Settings → Secrets and variables → Actions**:

- `SUPABASE_URL`: your project's HTTPS base URL (currently `https://ncvtnlrogpngaelqgvvt.supabase.co`).
- `SUPABASE_ANON_KEY`: the same project's anon or publishable API key from Supabase **Settings → API Keys**. You can reuse the value of `VITE_SUPABASE_ANON_KEY`; the secret names are separate.

The workflow authenticates with the public key and reads `/rest/v1/exercise_catalog?select=id&limit=1`. This existing table is protected by RLS; an empty result is successful. No user login, writes, new tables, or permission changes are needed. The response body is discarded. Elevated keys are rejected, and failed requests fail the workflow after bounded retries.

After adding secrets and merging, run it manually and confirm the database-read step succeeds. A daily read helps generate activity but does not guarantee uninterrupted availability. GitHub disables schedules in public repositories after 60 days without repository activity; re-enable the workflow if that happens.

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
