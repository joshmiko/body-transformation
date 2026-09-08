# Free Supabase setup

Create one free Supabase project for this repository. Choose a region close to you and use a strong database password.

After creation, provide the project URL and **anon/publishable key** only. Never commit a service-role key or database password.

## Required dashboard actions

1. In Authentication, enable email sign-in (or another chosen sign-in method).
2. In SQL Editor, run the migrations in order: `supabase/migrations/202608290001_initial_schema.sql`, then `supabase/migrations/202609060002_progress_photos.sql` for private progress-photo storage. The second migration creates a private bucket and per-user RLS policies; never make that bucket public.
3. Keep the free project active by opening it periodically; free projects can pause after inactivity.
4. Before importing real training history, export your existing browser data and retain the CSV source file separately.

## GitHub configuration

For a deployed web app, add these repository secrets in GitHub after the project exists:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are public client configuration values, but storing them as deployment secrets keeps environments explicit. Do not add database passwords or Supabase service-role keys to browser code, commits, or GitHub Actions.
