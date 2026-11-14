# Shift

A mobile-first personal fitness tracker for workouts, recovery, progress, and Coach plans that you approve before anything changes.

The app was renamed from Body Transformation to Shift. The repository, the app URL, browser storage keys, Supabase table names and OAuth client names keep their original `body-transformation` names, because changing them would break sign-in and saved data.

## Production

- App: https://joshmiko.github.io/body-transformation/
- Source of truth: the `main` branch
- Deployment: GitHub Pages after verification on `main`
- Local data: browser cache/offline drafts; Supabase is the durable sync target

## Local verification

Requires Node.js 20 or newer.

```sh
npm ci
npm run ci
```

Open `index.html` through a local static server for browser testing. Never put privileged Supabase keys or AI API keys in client files. Only publishable client configuration belongs in `env.js`; sensitive operations belong behind a server-side function.

## Change workflow

1. Start from current `main`.
2. Create `feature/<name>`, `fix/<name>`, or `chore/<name>`.
3. Make one bounded change and add regression coverage.
4. Run `npm run ci`.
5. Open a pull request and complete the mobile/data-integrity checklist.
6. Merge only after required checks pass.
7. Confirm the Pages deployment and run the production smoke test.

See [CONTRIBUTING.md](CONTRIBUTING.md), [release and rollback](docs/release-and-rollback.md), and [migration rules](docs/migrations.md).

## Sync architecture

When signed in, the app keeps the browser cache available for offline use, then synchronizes each workout, check-in, nutrition record/summary/target, recovery activity, and coaching-state record to Supabase's private `user_data_records` table. The app rehydrates from that canonical store on sign-in and load; stable record IDs make retries idempotent and unsynced local edits are protected during merges.

**App local/offline cache ↔ Supabase canonical store → Coach (read + send plans) → plan you approve in Shift → app**

### How Coach connects

Coach is Claude, connected through a custom connector to the `coaching-mcp` Supabase Edge Function. Coach can read your training data and send plans; nothing changes in Shift until you approve a plan. Setup steps are in [docs/coaching-mcp.md](docs/coaching-mcp.md).

The manual coaching package remains an advanced export/import fallback for offline recovery and debugging.

### One-time migration

1. Run `supabase/migrations/202609130003_canonical_sync_records.sql` after the existing migrations.
2. Sign in on each device once while online. The app uploads local records and pulls canonical records automatically.
3. Keep the existing manual package export as a backup until each device has completed that first sync.
