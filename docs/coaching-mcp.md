# Coach connection (Supabase coaching bridge)

Coach is Claude, connected to Shift through a **Claude custom connector**. The connector talks to the `coaching-mcp` Supabase Edge Function, which lets Coach read your training data and send plans. Nothing changes in Shift until you approve a plan in the app.

## Architecture

```
App local/offline cache ↔ Supabase canonical store → coaching-mcp (Coach reads, sends plans) → plan you approve in Shift → app
```

When the user is signed in, Supabase remains the canonical store. The app cache can work offline and retries idempotently. The `coaching-mcp` Edge Function reads `user_data_records` through a user-scoped Supabase client from the OAuth middleware, so every query is evaluated with the caller's RLS policies. The manual coaching package remains an advanced fallback/debug export, not a normal workflow.

## MCP tools

- `list_recent_workouts`: completed workouts, bounded to 1–100 rows, optional `since` date.
- `get_workout`: one normalized workout with program snapshot, exercises, warm-ups, working sets, rest, effort/RIR, notes, and timestamps.
- `get_coaching_context`: bounded date window (maximum 366 days) containing workouts, check-ins, nutrition, recovery, current program, and safe coaching watermark.
- `get_changes_since`: bounded timestamp-based incremental reads with a page cursor.

Read tools are annotated read-only. Write tools are explicitly non-destructive and idempotent, require confirmation, validate known optional fields, and write only `coaching_update_requests` plus an audit event. Responses are normalized and capped: progress photos, auth material, sync queues, tombstones, raw pending packages, and unrelated tables are not returned. Unknown fields in canonical payloads are ignored.

## Program state and history

`supabase/migrations/202609170001_program_state_canonical.sql` adds `program_state` to the canonical record types. The app's current/future program syncs under the stable source id `current`; each saved workout still carries its immutable `programSnapshot`, so historical workouts do not change when a future plan changes.

`src/supabase-rest.js` maps `program_state` in both directions. Rehydration restores the plan while preserving local unsynced edits, and the program revision guard (`202611060001_guard_program_state_revisions.sql`, fixed for upserts by `202611140001_fix_program_revision_guard_upsert.sql`) stops an older device from overwriting a newer plan.

## Write boundary and approval flow

Coach cannot write `user_data_records` or the legacy workout, nutrition, check-in, or program tables. Coach may create a draft plan and submit it; only the signed-in app session can approve, reject, and apply it. The app shows the plan before applying any change and preserves the current program snapshot.

Every request includes a caller-supplied idempotency key, a payload hash, and an optional expected coaching watermark. Repeating a request with the same key and payload is safe; changing the payload returns an idempotency conflict. A stale expected watermark returns a conflict instead of overwriting a newer review. Audit rows record each step. No tool can edit or delete a completed workout, nutrition history, progress photo, or immutable workout `programSnapshot`.

## Connecting Coach (Claude custom connector)

Dynamic client registration is **off** in Supabase Auth, so Claude cannot register itself. The connector uses an OAuth client registered by hand instead.

1. **Supabase Auth settings** (already in place):
   - The project uses an asymmetric JWT signing key (ES256 or RS256). No service-role key is used in the browser or the function.
   - The OAuth 2.1 server is enabled, with dynamic client registration turned off.
   - Site URL: `https://joshmiko.github.io/body-transformation`.
   - Authorization/consent path: `https://joshmiko.github.io/body-transformation/oauth/consent.html`.
2. **Register the OAuth client by hand** in Supabase Auth:
   - Client type: **public** (no client secret).
   - Redirect URI: `https://claude.ai/api/mcp/auth_callback`.
   - Keep the generated client ID out of this repository. It is configuration for your Claude account, not source code.
3. **Add the connector in Claude** as a custom connector:
   - URL: `https://ncvtnlrogpngaelqgvvt.supabase.co/functions/v1/coaching-mcp`
   - In the connector's advanced OAuth settings, enter the client ID from step 2 and leave the client secret empty.
4. **Connect.** Claude opens the Shift consent page. Sign in, confirm the account, and approve the connection.
5. **Revoke** by removing the connector in Claude or revoking the grant in Supabase Auth.

The function is deployed from a reviewed checkout with `supabase functions deploy coaching-mcp --no-verify-jwt`; the middleware performs OAuth discovery and user authentication.

The browser app needs only the publishable key. No AI provider API key, database password, personal access token, or service-role secret is required for this bridge.

## Validation

Run `npm run ci`. When the bridge or its policies change, also check with the MCP Inspector or the Claude connector against a test user:
- a second user cannot see the first user's records;
- Coach cannot write canonical tables;
- approving in the app is the only way a plan takes effect.
