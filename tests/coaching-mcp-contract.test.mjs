import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("bridge contract is user-scoped, read-only, and program-state aware", async () => {
  const [server, rest, migration, writeMigration, config, writeBridge] = await Promise.all([
    readFile(new URL("../supabase/functions/coaching-mcp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/supabase-rest.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202609170001_program_state_canonical.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202609190001_coaching_bridge_write_queue.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/coaching-mcp/write-bridge.mjs", import.meta.url), "utf8")
  ]);
  for (const tool of ["list_recent_workouts", "get_workout", "get_coaching_context", "get_changes_since"]) assert.ok(server.includes(tool));
  assert.ok(server.includes('withSupabase({ auth: "user" })'));
  assert.ok(server.includes("readOnlyHint: true"));
  assert.equal(/service_role|SUPABASE_SERVICE_ROLE_KEY|database password/i.test(server), false);
  for (const tool of ["create_coach_update_draft", "submit_coach_update"]) assert.ok(server.includes(tool));
  assert.ok(server.includes("confirm: z.literal(true)"));
  assert.ok(server.includes("idempotencyKey"));
  assert.ok(server.includes("expectedWatermark"));
  assert.ok(server.includes("coaching_update_requests"));
  assert.ok(server.includes("readOnlyHint: false"));
  assert.ok(writeMigration.includes("block oauth clients from legacy data"));
  assert.ok(writeMigration.includes("auth.jwt() ->> 'client_id'"));
  assert.ok(writeMigration.includes("bt_guard_coaching_update_request"));
  assert.ok(rest.includes("listCoachUpdateRequests"));
  assert.ok(writeBridge.includes("validateCoachUpdate"));
  assert.ok(rest.includes("setCanonicalProgramState"));
  assert.ok(rest.includes('record_type === "program_state"'));
  assert.ok(migration.includes("'program_state'"));
  assert.ok(config.includes("[functions.coaching-mcp]"));
  assert.ok(config.includes("verify_jwt = false"));
});
