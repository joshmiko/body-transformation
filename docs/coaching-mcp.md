# Read-only coaching bridge (review release)

This branch adds a review-only bridge for ChatGPT Developer Mode. It is intentionally separate from \`main\`: no Edge Function deployment, production migration, or Supabase dashboard change is performed here.

## Architecture

\`\`\`
App local/offline cache ↔ Supabase canonical store → coaching/export adapter → reviewed coach update → app
\`\`\`

When the user is signed in, Supabase remains the canonical store. The app cache can work offline and retries idempotently. The \`coaching-mcp\` Edge Function is a read-only adapter over \`user_data_records\`; it receives a user-scoped Supabase client from OAuth middleware, so every query is evaluated with the caller's RLS policies. The existing manual coaching package remains an advanced fallback/debug export, not a normal workflow.

## MCP tools

- \`list_recent_workouts\`: completed workouts, bounded to 1–100 rows, optional \`since\` date.
- \`get_workout\`: one normalized workout with program snapshot, exercises, warm-ups, working sets, rest, effort/RIR, notes, and timestamps.
- \`get_coaching_context\`: bounded date window (maximum 366 days) containing workouts, check-ins, nutrition, recovery, current program, and safe coaching watermark.
- \`get_changes_since\`: bounded timestamp-based incremental reads with a page cursor.

Tools are annotated read-only and never write data. Responses are normalized and capped: progress photos, auth material, sync queues, tombstones, raw pending packages, and unrelated tables are not returned. Unknown fields in canonical payloads are ignored.

## Program state and history

\`supabase/migrations/202609170001_program_state_canonical.sql\` adds \`program_state\` to the existing canonical record type check. The app's current/future program can be synced under the stable source id \`current\`; each saved workout still carries its immutable \`programSnapshot\`, so historical workouts do not change when a future plan changes. The migration is forward-compatible and is not applied by this review branch.

\`src/supabase-rest.js\` maps \`program_state\` in both directions. If a local \`db.programState\`, \`db.nextWeekProgram\`, or \`globalThis.__BT_PROGRAM_STATE__\` is present, it is queued as a canonical program record. Rehydration restores \`db.nextWeekProgram\` while preserving local unsynced edits.

## One-time dashboard steps (future, after review)

1. Confirm the Supabase project uses an asymmetric JWT signing key (ES256 or RS256). Do not use a service-role key in the browser or MCP.
2. Enable the Supabase Auth OAuth 2.1 server and dynamic client registration.
3. Set the Site URL to \`https://joshmiko.github.io/body-transformation\`.
4. Set the OAuth authorization/consent path to \`https://joshmiko.github.io/body-transformation/oauth/consent.html\`.
5. Review and apply \`202609170001_program_state_canonical.sql\` after backing up the canonical table.
6. Deploy the function from a reviewed checkout with \`supabase functions deploy coaching-mcp --no-verify-jwt\`. The middleware performs OAuth discovery and user authentication.
7. In ChatGPT Developer Mode, add the public function URL: \`https://ncvtnlrogpngaelqgvvt.supabase.co/functions/v1/coaching-mcp\`.
8. Complete the consent screen, verify the four read-only tools, and revoke the grant in Supabase Auth when no longer needed.

The browser app needs only the publishable key. No OpenAI API key, database password, personal access token, or service-role secret is required for this bridge.

## Validation

Run \`npm run ci\` on the branch. A later supervised rollout should additionally use the MCP Inspector/ChatGPT Developer Mode against a test user and verify that a second user cannot see the first user's records. This branch deliberately stops before those external setup steps and before any production write.
