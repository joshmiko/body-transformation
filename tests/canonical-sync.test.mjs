import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map([
  ["bt_supabase_session", JSON.stringify({ access_token: "test-token", user: { id: "user-1" } })]
]);
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};

let requests = [];
let failNextWrite = false;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  if (failNextWrite && options.method === "POST") {
    failNextWrite = false;
    throw new Error("offline");
  }
  if (options.method === "POST") {
    return { ok: true, status: 200, json: async () => JSON.parse(options.body || "[]"), text: async () => "" };
  }
  return { ok: true, status: 200, json: async () => [], text: async () => "" };
};

const supabase = await import("../src/supabase-rest.js?canonical-sync-test");

const baseSession = {
  id: "session-1",
  programDay: "Monday",
  performedDate: "2026-08-31",
  finished: "2026-09-12T15:00:00.000Z",
  status: "saved",
  exercises: {}
};

test("canonical merge preserves programDay and prefers newer cloud records", () => {
  const local = { sessions: { "session-1": baseSession }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  const cloud = { ...baseSession, sessionNote: "synced from iPhone" };
  const merged = supabase.mergeCanonicalRecords(local, [{
    record_type: "workout_session",
    source_record_id: "session-1",
    payload: cloud,
    updated_at: "2026-09-12T16:00:00.000Z"
  }]);
  assert.equal(merged.sessions["session-1"].programDay, "Monday");
  assert.equal(merged.sessions["session-1"].performedDate, "2026-08-31");
  assert.equal(merged.sessions["session-1"].sessionNote, "synced from iPhone");
});

test("sync writes every local domain with stable idempotency keys", async () => {
  requests = [];
  const db = {
    sessions: { "session-1": baseSession },
    checkins: [{ id: "checkin-1", date: "2026-08-31", weight: 180 }],
    nutrition: {
      targets: { calories: 2200, protein: 180 },
      entries: [{ id: "food-1", date: "2026-08-31", name: "Lunch", calories: 600, protein: 40 }],
      dailySummaries: [{ id: "summary-1", date: "2026-08-31", calories: 2200, protein: 180 }]
    },
    recoveryActivities: [{ id: "recovery-1", programDay: "Tuesday", performedDate: "2026-09-01", completed: true }],
    coachSync: { reviewedWatermark: "2026-08-30T00:00:00.000Z", pendingPackages: [], imports: [] }
  };
  const result = await supabase.syncLocalDb(db);
  assert.equal(result.offline, false);
  assert.equal(result.records, 7);
  const post = requests.find(x => x.url.includes("/user_data_records?"));
  assert.ok(post, "canonical upsert request should be sent");
  assert.match(post.options.headers.Prefer, /resolution=merge-duplicates/);
  const rows = JSON.parse(post.options.body);
  assert.deepEqual(rows.map(x => x.record_type).sort(), [
    "checkin", "coaching_state", "nutrition_entry", "nutrition_summary", "nutrition_target", "recovery_activity", "workout_session"
  ]);
  assert.equal(new Set(rows.map(x => x.source_record_id)).size, rows.length);\n  assert.ok(rows.every(row => row.user_id === "user-1"));
});

test("offline writes queue and retry without creating duplicate keys", async () => {
  const db = { sessions: { "session-1": baseSession }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  requests = [];
  failNextWrite = true;
  const failed = await supabase.syncLocalDb(db);
  assert.equal(failed.offline, true);
  assert.ok(JSON.parse(storage.get("bt_supabase_canonical_sync_queue")).length >= 1);
  const retried = await supabase.syncLocalDb(db);
  assert.equal(retried.offline, false);
  assert.equal(JSON.parse(storage.get("bt_supabase_canonical_sync_queue")).length, 0);
  const posts = requests.filter(x => x.url.includes("/user_data_records?"));
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[0].options.body)[0].source_record_id, JSON.parse(posts[1].options.body)[0].source_record_id);
});

test("rehydration pulls canonical records into an empty device cache", async () => {
  const cloudSession = { ...baseSession, sessionNote: "from desktop" };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("user_data_records?select=")) {
      return { ok: true, status: 200, json: async () => [{ record_type: "workout_session", source_record_id: "session-1", payload: cloudSession, updated_at: "2026-09-12T16:00:00.000Z" }], text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  const merged = await supabase.rehydrateLocalDb({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] });
  assert.equal(merged.sessions["session-1"].sessionNote, "from desktop");
  assert.equal(merged.sessions["session-1"].programDay, "Monday");
});
