import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};

let requests = [];
let fetchImpl = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  return { ok: true, status: 200, json: async () => [], text: async () => "" };
};
globalThis.fetch = (...args) => fetchImpl(...args);

const supabase = await import("../src/supabase-rest.js?supabase-reliability-tests");

function session(overrides = {}) {
  return {
    access_token: "expired-token",
    refresh_token: "refresh-token",
    expires_at: Math.floor(Date.now() / 1000) - 60,
    user: { id: "user-1" },
    ...overrides
  };
}

function reset() {
  storage.clear();
  requests = [];
  fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
}

test("expired access token refreshes once and retries the request", async () => {
  reset();
  localStorage.setItem("bt_supabase_session", JSON.stringify(session()));
  fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/rest/v1/")) {
      if (requests.filter(item => item.url.includes("/rest/v1/")).length === 1) {
        return { ok: false, status: 401, json: async () => ({}), text: async () => "expired" };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => ({ access_token: "fresh-token", refresh_token: "fresh-refresh", expires_in: 3600, user: { id: "user-1" } }), text: async () => "" };
  };
  await supabase.listOwnSessions();
  assert.equal(requests.filter(item => item.url.includes("/auth/v1/token")).length, 1);
  const restRequests = requests.filter(item => item.url.includes("/rest/v1/"));
  assert.equal(restRequests.length, 2);
  assert.match(restRequests[1].options.headers.Authorization, /fresh-token/);
});

test("refresh failure is bounded and reports sign-in required", async () => {
  reset();
  localStorage.setItem("bt_supabase_session", JSON.stringify(session()));
  fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/auth/v1/token")) return { ok: false, status: 400, json: async () => ({ error_description: "refresh denied" }), text: async () => "refresh denied" };
    return { ok: false, status: 401, json: async () => ({}), text: async () => "expired" };
  };
  await assert.rejects(() => supabase.listOwnSessions(), error => error.code === "AUTH_REQUIRED");
  assert.equal(requests.filter(item => item.url.includes("/auth/v1/token")).length, 1);
});

test("pending local edits win over an older cloud record", () => {
  reset();
  const local = {
    sessions: { "session-1": { id: "session-1", programDay: "Monday", sessionNote: "edited offline", updatedAt: "2026-09-12T18:00:00.000Z" } },
    checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: []
  };
  const pending = {
    record_type: "workout_session", source_record_id: "session-1",
    payload: local.sessions["session-1"], updated_at: "2026-09-12T18:00:00.000Z"
  };
  const merged = supabase.mergeCanonicalRecords(local, [{
    record_type: "workout_session", source_record_id: "session-1",
    payload: { id: "session-1", programDay: "Monday", sessionNote: "old cloud" },
    updated_at: "2026-09-12T17:00:00.000Z"
  }], { pendingRows: [pending] });
  assert.equal(merged.sessions["session-1"].sessionNote, "edited offline");
});

test("check-ins without ids receive a stable id before sync", async () => {
  reset();
  localStorage.setItem("bt_supabase_session", JSON.stringify(session({ access_token: "valid-token", expires_at: Math.floor(Date.now() / 1000) + 3600 })));
  const db = { sessions: {}, checkins: [{ date: "2026-09-12", weight: 180 }], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  await supabase.syncLocalDb(db);
  const firstId = db.checkins[0].id;
  assert.ok(firstId);
  requests = [];
  await supabase.syncLocalDb(db);
  const bodies = requests.filter(item => item.url.includes("/user_data_records?")).map(item => JSON.parse(item.options.body));
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0][0].source_record_id, firstId);
  assert.equal(bodies[1][0].source_record_id, firstId);
});

test("deleting a previously synced record creates a tombstone and prevents resurrection", async () => {
  reset();
  localStorage.setItem("bt_supabase_session", JSON.stringify(session({ access_token: "valid-token", expires_at: Math.floor(Date.now() / 1000) + 3600 })));
  const db = { sessions: { "session-1": { id: "session-1", programDay: "Monday" } }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  let cloudRows = [];
  fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === "POST") {
      cloudRows = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => cloudRows, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => cloudRows, text: async () => "" };
  };
  await supabase.syncLocalDb(db);
  delete db.sessions["session-1"];
  await supabase.syncLocalDb(db);
  assert.equal(cloudRows[0].payload.__deleted, true);
  const restored = await supabase.rehydrateLocalDb(db);
  assert.equal(Object.keys(restored.sessions).length, 0);
});

test("a change made during sync gets a follow-up attempt", async () => {
  reset();
  localStorage.setItem("bt_supabase_session", JSON.stringify(session({ access_token: "valid-token", expires_at: Math.floor(Date.now() / 1000) + 3600 })));
  const db = { sessions: { "session-1": { id: "session-1", programDay: "Monday", sessionNote: "first" } }, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === "POST") {
      await gate;
      return { ok: true, status: 200, json: async () => [], text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  const first = supabase.syncLocalDb(db);
  db.sessions["session-1"].sessionNote = "second";
  const second = supabase.syncLocalDb(db);
  release();
  await Promise.all([first, second]);
  assert.equal(requests.filter(item => item.url.includes("/user_data_records?")).length, 2);
});
