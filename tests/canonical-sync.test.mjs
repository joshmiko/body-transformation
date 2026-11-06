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


test("canonical program state rehydrates its effective date without rewriting saved snapshots", () => {
  const historicalSnapshot = { Monday: { title: "Historical Monday", exercises: [] } };
  const local = {
    sessions: { "session-1": { ...baseSession, programSnapshot: historicalSnapshot } },
    checkins: [],
    nutrition: { entries: [], dailySummaries: [] },
    recoveryActivities: [],
    nextWeekProgram: {
      Monday: { title: "Existing Monday", exercises: [] },
      Wednesday: { title: "Existing Wednesday", exercises: [] },
      Friday: { title: "Old Friday", exercises: [] },
      Saturday: { title: "Existing Saturday", exercises: [] }
    },
    nextWeekProgramEffectiveDate: "2026-09-21"
  };
  const proposedProgram = {
    Friday: { title: "Updated Friday", exercises: [{ name: "Deadlift", coachLoad: { weightLb: 285, optionalWeightLb: 290, condition: "Warm-ups feel solid" } }] },
    Saturday: { title: "Updated Saturday", exercises: [] }
  };
  const merged = supabase.mergeCanonicalRecords(local, [{
    record_type: "program_state",
    source_record_id: "current",
    payload: {
      schemaVersion: 1,
      currentProgram: proposedProgram,
      programEffectiveDate: "2026-09-25",
      updatedAt: "2026-09-24T12:00:00.000Z"
    },
    updated_at: "2026-09-24T12:00:00.000Z"
  }]);
  assert.equal(merged.nextWeekProgram.Monday.title, "Existing Monday");
  assert.equal(merged.nextWeekProgram.Wednesday.title, "Existing Wednesday");
  assert.equal(merged.nextWeekProgram.Friday.title, "Updated Friday");
  assert.equal(merged.nextWeekProgram.Friday.exercises[0].coachLoad.weightLb, 285);
  assert.equal(merged.nextWeekProgram.Saturday.title, "Updated Saturday");
  assert.equal(merged.nextWeekProgramEffectiveDate, "2026-09-25");
  assert.equal(merged.nextWeekProgramUpdatedAt, "2026-09-24T12:00:00.000Z");
  assert.deepEqual(merged.sessions["session-1"].programSnapshot, historicalSnapshot);
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
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
  assert.equal(new Set(rows.map(x => x.source_record_id)).size, rows.length);
  assert.ok(rows.every(row => row.user_id === "user-1"));
});

test("offline writes queue and retry without creating duplicate keys", async () => {
  const db = { sessions: { "session-1": baseSession }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  requests = [];
  failNextWrite = true;
  const failed = await supabase.syncLocalDb(db);
  assert.equal(failed.offline, true);
  assert.ok(JSON.parse(storage.get(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1"))).length >= 1);
  const retried = await supabase.syncLocalDb(db);
  assert.equal(retried.offline, false);
  assert.equal(JSON.parse(storage.get(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1"))).length, 0);
  const posts = requests.filter(x => x.url.includes("/user_data_records?"));
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[0].options.body)[0].source_record_id, JSON.parse(posts[1].options.body)[0].source_record_id);
});

test("the current local workout wins over an older queued copy with the same ID", async () => {
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
  const workout = { ...baseSession, sessionNote: "captured before disconnect" };
  const db = { sessions: { "session-1": workout }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  requests = [];
  failNextWrite = true;
  await supabase.syncLocalDb(db);
  workout.sessionNote = "edited while offline";
  await supabase.syncLocalDb(db);
  const posts = requests.filter(x => x.url.includes("/user_data_records?"));
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[1].options.body).find(x => x.record_type === "workout_session").payload.sessionNote, "edited while offline");
  assert.equal(supabase.workoutSyncStatus(workout).state, "synced");
  workout.sessionNote = "edited after acknowledgement";
  assert.equal(supabase.workoutSyncStatus(workout).state, "pending");
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

test("an old page preview cannot upload a program while syncing a workout", async () => {
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1"));
  supabase.mergeCanonicalRecords({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] }, [{ record_type: "program_state", source_record_id: "current", payload: { revision: 1, updatedAt: "2026-10-05T12:19:04Z" }, updated_at: "2026-10-05T12:19:04Z" }]);
  globalThis.__BT_PROGRAM_STATE__ = { updatedAt: "2026-10-05T12:19:04Z", weeklyPrograms: [] };
  requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => options.method === "POST" ? JSON.parse(options.body) : [], text: async () => "" };
  };
  const result = await supabase.syncLocalDb({ sessions: { "session-1": baseSession }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] });
  assert.equal(result.status, "synced");
  const uploaded = requests.filter(x => x.options.method === "POST").flatMap(x => JSON.parse(x.options.body));
  assert.ok(uploaded.some(x => x.record_type === "workout_session"));
  assert.ok(!uploaded.some(x => x.record_type === "program_state"));
  delete globalThis.__BT_PROGRAM_STATE__;
});

test("a second device receives an approved plan without uploading its older copy", async () => {
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1"));
  const oldPlan = { revision: 1, updatedAt: "2026-11-03T18:00:00Z", weeklyPrograms: [], currentProgram: { Friday: { title: "Old Friday" } } };
  const approvedPlan = { revision: 2, updatedAt: "2026-11-03T18:32:53Z", weeklyPrograms: [{ requestId: "approved-week", startDate: "2026-11-02", endDate: "2026-11-08", days: { Friday: { title: "Hockey-aware Friday" } } }], currentProgram: oldPlan.currentProgram, lastCoachRequestId: "approved-week" };
  const oldDevice = supabase.mergeCanonicalRecords({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] }, [{ record_type: "program_state", source_record_id: "current", payload: oldPlan, updated_at: "2026-11-03T18:00:00Z" }]);
  oldDevice.sessions["new-workout"] = { ...baseSession, id: "new-workout" };
  let cloudProgram = approvedPlan;
  requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === "POST") {
      const uploaded = JSON.parse(options.body);
      if (uploaded.some(x => x.record_type === "program_state")) throw new Error("Old program upload attempted");
      return { ok: true, status: 200, json: async () => uploaded, text: async () => "" };
    }
    const rows = [{ record_type: "program_state", source_record_id: "current", payload: cloudProgram, updated_at: "2026-11-03T18:32:53Z" }];
    return { ok: true, status: 200, json: async () => rows, text: async () => "" };
  };
  const merged = await supabase.rehydrateLocalDb(oldDevice);
  assert.equal(merged.programState.revision, 2);
  assert.equal(merged.weeklyPrograms[0].requestId, "approved-week");
  assert.equal(merged.sessions["new-workout"].id, "new-workout");
  assert.equal(cloudProgram.weeklyPrograms[0].requestId, "approved-week");
  const uploads = requests.filter(x => x.options.method === "POST").flatMap(x => JSON.parse(x.options.body));
  assert.ok(uploads.some(x => x.record_type === "workout_session"));
  assert.ok(!uploads.some(x => x.record_type === "program_state"));
});

test("a queued unversioned program cannot hide a newer approved cloud plan", async () => {
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
  const queueKey = supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1");
  const oldPlan = { updatedAt: "2026-10-05T12:19:04Z", weeklyPrograms: [] };
  const approved = { revision: 1, updatedAt: "2026-11-03T18:32:53Z", weeklyPrograms: [{ requestId: "approved-week", startDate: "2026-11-02", endDate: "2026-11-08", days: {} }] };
  const local = supabase.mergeCanonicalRecords({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] }, [{ record_type: "program_state", source_record_id: "current", payload: oldPlan, updated_at: "2026-10-05T12:19:04Z" }]);
  storage.set(queueKey, JSON.stringify([{ record_type: "program_state", source_record_id: "current", payload: oldPlan, updated_at: "2026-11-05T12:00:00Z" }]));
  let submitted = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      submitted.push(...JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => submitted, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [{ record_type: "program_state", source_record_id: "current", payload: approved, updated_at: "2026-11-03T18:32:53Z" }], text: async () => "" };
  };
  const merged = await supabase.rehydrateLocalDb(local);
  assert.equal(merged.weeklyPrograms[0].requestId, "approved-week");
  assert.deepEqual(submitted.filter(x => x.record_type === "program_state").map(x => x.payload.revision), [1]);
  assert.equal(JSON.parse(storage.get(queueKey)).length, 0);
});

test("a rejected stale program revision does not block a workout upload", async () => {
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1"));
  const oldPlan = { revision: 1, updatedAt: "2026-11-03T18:00:00Z", weeklyPrograms: [] };
  const oldDevice = supabase.mergeCanonicalRecords({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] }, [{ record_type: "program_state", source_record_id: "current", payload: oldPlan, updated_at: "2026-11-03T18:00:00Z" }]);
  oldDevice.programState = { ...oldPlan, revision: 2, updatedAt: "2026-11-03T19:00:00Z", plannedEvents: [{ id: "new-game" }] };
  oldDevice.sessions["new-workout"] = { ...baseSession, id: "new-workout" };
  let workoutUploaded = false;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      const uploaded = JSON.parse(options.body);
      if (uploaded.some(x => x.record_type === "program_state")) return { ok: false, status: 409, text: async () => "PROGRAM_REVISION_CONFLICT" };
      workoutUploaded = uploaded.some(x => x.record_type === "workout_session");
      return { ok: true, status: 200, json: async () => uploaded, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  const result = await supabase.syncLocalDb(oldDevice);
  assert.equal(result.errorCode, "PROGRAM_CONFLICT");
  assert.equal(workoutUploaded, true);
  const queued = JSON.parse(storage.get(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1")));
  assert.deepEqual(queued.map(x => x.record_type), ["program_state"]);
});
