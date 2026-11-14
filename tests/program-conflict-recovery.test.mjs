import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const storage = new Map([
  ["bt_supabase_session", JSON.stringify({ access_token: "test-token", user: { id: "user-1" } })]
]);
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" });

const supabase = await import("../src/supabase-rest.js?program-conflict-recovery-test");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const emptyDb = () => ({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] });
const metaKey = () => supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1");
const queueKey = () => supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1");
const programRow = payload => ({ record_type: "program_state", source_record_id: "current", payload, updated_at: payload.updatedAt });

// Mirrors supabase/migrations/202611060001_guard_program_state_revisions.sql.
function guardedCloud(initialProgram) {
  const cloud = { program: initialProgram, programWrites: 0 };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      const rows = JSON.parse(options.body);
      for (const row of rows.filter(x => x.record_type === "program_state")) {
        const same = JSON.stringify(row.payload) === JSON.stringify(cloud.program);
        if (!same && Number(row.payload.revision) !== Number(cloud.program.revision) + 1) {
          return { ok: false, status: 400, text: async () => "PROGRAM_REVISION_CONFLICT: refresh the current program before editing" };
        }
        if (!same) cloud.programWrites++;
        cloud.program = row.payload;
      }
      return { ok: true, status: 200, json: async () => rows, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [programRow(cloud.program)], text: async () => "" };
  };
  return cloud;
}

function deviceSyncedAt(program) {
  storage.delete(metaKey());
  storage.delete(queueKey());
  return supabase.mergeCanonicalRecords(emptyDb(), [programRow(program)]);
}

test("same revision with different content: refresh takes the cloud plan and clears the conflict", async () => {
  const base = { revision: 1, updatedAt: "2026-11-06T10:00:00Z", plannedEvents: [] };
  const device = deviceSyncedAt(base);
  const cloud = guardedCloud({ revision: 2, updatedAt: "2026-11-06T11:00:00Z", plannedEvents: [{ id: "other-device-game" }] });
  device.programState = { revision: 2, updatedAt: "2026-11-06T11:05:00Z", plannedEvents: [{ id: "this-device-game" }] };

  const first = await supabase.syncLocalDb(device);
  assert.equal(first.errorCode, "PROGRAM_CONFLICT");

  const refreshed = await supabase.rehydrateLocalDb(device);
  assert.deepEqual(refreshed.programState.plannedEvents, [{ id: "other-device-game" }]);
  const after = await supabase.syncLocalDb(refreshed);
  assert.equal(after.status, "synced");
  assert.equal(after.errorCode, undefined);
  assert.equal(cloud.program.plannedEvents[0].id, "other-device-game");
  assert.deepEqual(JSON.parse(storage.get(queueKey()) || "[]"), []);
});

test("an unversioned local plan after the revision migration recovers on refresh", async () => {
  const device = deviceSyncedAt({ updatedAt: "2026-11-01T10:00:00Z", plannedEvents: [] });
  delete device.programState.revision;
  delete device.programState.cloudSyncedAt;
  guardedCloud({ revision: 1, updatedAt: "2026-11-06T05:00:00Z", plannedEvents: [{ id: "migrated" }] });
  device.programState = { revision: 1, updatedAt: "2026-11-06T09:00:00Z", plannedEvents: [{ id: "local" }] };
  assert.equal((await supabase.syncLocalDb(device)).errorCode, "PROGRAM_CONFLICT");
  const refreshed = await supabase.rehydrateLocalDb(device);
  assert.equal(refreshed.programState.plannedEvents[0].id, "migrated");
  assert.equal((await supabase.syncLocalDb(refreshed)).status, "synced");
});

test("a local revision that skipped ahead is replaced by the cloud plan on refresh", async () => {
  const device = deviceSyncedAt({ revision: 2, updatedAt: "2026-11-06T10:00:00Z", plannedEvents: [] });
  guardedCloud({ revision: 2, updatedAt: "2026-11-06T10:00:00Z", plannedEvents: [] });
  device.programState = { revision: 4, updatedAt: "2026-11-06T12:00:00Z", plannedEvents: [{ id: "skipped" }] };
  assert.equal((await supabase.syncLocalDb(device)).errorCode, "PROGRAM_CONFLICT");
  const refreshed = await supabase.rehydrateLocalDb(device);
  assert.equal(refreshed.programState.revision, 2);
  assert.equal((await supabase.syncLocalDb(refreshed)).status, "synced");
});

test("a valid next-revision local edit survives refresh and uploads", async () => {
  const device = deviceSyncedAt({ revision: 2, updatedAt: "2026-11-06T10:00:00Z", plannedEvents: [] });
  const cloud = guardedCloud({ revision: 2, updatedAt: "2026-11-06T10:00:00Z", plannedEvents: [] });
  device.programState = { revision: 3, updatedAt: "2026-11-06T12:00:00Z", plannedEvents: [{ id: "new-game" }] };
  const refreshed = await supabase.rehydrateLocalDb(device);
  assert.equal(refreshed.programState.revision, 3);
  assert.equal(cloud.program.revision, 3);
  assert.equal(cloud.program.plannedEvents[0].id, "new-game");
  assert.equal(cloud.programWrites, 1);
});

test("staging does not bump the revision again for an edit that has not synced", () => {
  const stage = html.match(/^function stageProgramState\(\).*$/m)?.[0];
  assert.ok(stage);
  const context = {
    db: {},
    coachCurrentProgram: () => ({}),
    weeklyPrograms: () => [],
    plannedGames: () => [],
    cloneValue: value => JSON.parse(JSON.stringify(value))
  };
  vm.createContext(context);
  vm.runInContext(stage, context);

  context.db.programState = { revision: 2, cloudSyncedAt: "2026-11-06T10:00:00Z" };
  assert.equal(context.stageProgramState().revision, 3, "synced plan → next revision");
  assert.equal(context.stageProgramState().revision, 3, "second offline edit keeps the pending revision");
  context.db.programState = { cloudSyncedAt: "2026-11-01T10:00:00Z" };
  assert.equal(context.stageProgramState().revision, 2, "synced pre-revision plan maps to migrated revision 1");
  context.db.programState = null;
  assert.equal(context.stageProgramState().revision, 1, "first plan starts at 1");
});
