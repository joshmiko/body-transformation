const config = globalThis.__BT_CONFIG__ || {
  supabaseUrl: "https://ncvtnlrogpngaelqgvvt.supabase.co",
  supabaseAnonKey: "sb_publishable_Omsxr2yIpZG8krgJfZql7A_DPfJnIHW"
};
const projectUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
const publishableKey = String(config.supabaseAnonKey || "");
const sessionKey = "bt_supabase_session";
const canonicalQueueKeyPrefix = "bt_supabase_canonical_sync_queue";
const canonicalMetaKeyPrefix = "bt_supabase_canonical_sync_meta_v2";
export function accountScopedStorageKey(prefix, userId) {
  const id = String(userId || "anonymous").trim() || "anonymous";
  return String(prefix || "bt") + ":" + id;
}
function currentAccountId() {
  return String(readSession().user?.id || "").trim() || "anonymous";
}
function canonicalQueueKey() {
  return accountScopedStorageKey(canonicalQueueKeyPrefix, currentAccountId());
}
function canonicalMetaKey() {
  return accountScopedStorageKey(canonicalMetaKeyPrefix, currentAccountId());
}
let syncInFlight = null;
let syncRequested = false;
let latestSyncDb = null;
let refreshInFlight = null;
let rehydrateInFlight = null;
let canonicalProgramState = null;

export const supabaseConfigured = Boolean(projectUrl && publishableKey);

const safeJson = (value, fallback = null) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function readSession() {
  return safeJson(globalThis.localStorage?.getItem(sessionKey) || "", null) || {};
}

function normaliseSession(payload) {
  const next = { ...(payload || {}) };
  if (!next.expires_at && next.expires_in) {
    next.expires_at = Math.floor(Date.now() / 1000) + Number(next.expires_in);
  }
  return next;
}

function writeSession(payload) {
  const next = normaliseSession(payload);
  globalThis.localStorage?.setItem(sessionKey, JSON.stringify(next));
  return next;
}

const syncStatus = { state: "idle", message: "" };
const syncSubscribers = new Set();

function setSyncStatus(state, message) {
  syncStatus.state = state;
  syncStatus.message = message || "";
  syncSubscribers.forEach(listener => {
    try { listener({ ...syncStatus }); } catch {}
  });
  if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
    try { globalThis.dispatchEvent(new CustomEvent("bt-sync-status", { detail: { ...syncStatus } })); } catch {}
  }
  return { ...syncStatus };
}

export function setCanonicalProgramState(value) {
  canonicalProgramState = value && typeof value === "object" ? value : null;
  return canonicalProgramState;
}

export function getSyncStatus() {
  return { ...syncStatus };
}

export function subscribeSyncStatus(listener) {
  if (typeof listener !== "function") return () => {};
  syncSubscribers.add(listener);
  return () => syncSubscribers.delete(listener);
}

async function refreshSession({ force = false } = {}) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  const current = readSession();
  if (!force && current.access_token && current.expires_at && Number(current.expires_at) * 1000 > Date.now() + 30000) return current;
  if (!current.refresh_token) {
    const error = new Error("Sign-in required to sync");
    error.code = "AUTH_REQUIRED";
    setSyncStatus("sign-in-needed", error.message);
    throw error;
  }
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetch(projectUrl + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh_token })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const error = new Error(payload.error_description || payload.msg || "Sign-in required to sync");
      error.code = "AUTH_REQUIRED";
      setSyncStatus("sign-in-needed", error.message);
      throw error;
    }
    const refreshed = { ...current, ...payload, refresh_token: payload.refresh_token || current.refresh_token, user: payload.user || current.user };
    if (payload.expires_in && !payload.expires_at) delete refreshed.expires_at;
    return writeSession(refreshed);
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function authHeaders() {
  const session = readSession();
  const token = session.access_token || publishableKey;
  return { apikey: publishableKey, Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

async function request(path, options = {}, retryAuth = true) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  const response = await fetch(projectUrl + "/rest/v1/" + path, {
    ...options,
    headers: { ...(await authHeaders()), ...(options.headers || {}) }
  });
  if (response.status === 401 && retryAuth && readSession().refresh_token) {
    try {
      await refreshSession({ force: true });
      return request(path, options, false);
    } catch (error) {
      const authError = error?.code === "AUTH_REQUIRED" ? error : Object.assign(new Error("Sign-in required to sync"), { code: "AUTH_REQUIRED" });
      setSyncStatus("sign-in-needed", authError.message);
      throw authError;
    }
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Supabase request failed (" + response.status + "): " + detail);
  }
  return response.status === 204 ? null : response.json();
}

export function listOwnSessions(query = "select=*&order=occurred_on.desc") {
  return request("workout_sessions?" + query);
}

export function createSession(session) {
  return request("workout_sessions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(session)
  });
}

export function createCheckin(checkin) {
  return request("body_checkins", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(checkin)
  });
}

export async function signIn(email, password) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  const response = await fetch(projectUrl + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.msg || "Sign-in failed");
  writeSession(payload);
  setSyncStatus("idle", "");
  return payload.user;
}

export function signOut() {
  globalThis.localStorage?.removeItem(sessionKey);
  setSyncStatus("sign-in-needed", "Sign in to sync");
}

export function currentUser() {
  return readSession().user || null;
}

export function sessionActive() {
  const session = readSession();
  return Boolean(session.access_token || session.refresh_token);
}

function readCanonicalQueue() {
  const value = safeJson(globalThis.localStorage?.getItem(canonicalQueueKey()) || "[]", []);
  return Array.isArray(value) ? value : [];
}

function writeCanonicalQueue(rows) {
  globalThis.localStorage?.setItem(canonicalQueueKey(), JSON.stringify((rows || []).slice(-500)));
}

function readCanonicalMeta() {
  const value = safeJson(globalThis.localStorage?.getItem(canonicalMetaKey()) || "{}", {});
  return value && typeof value === "object" && value.records && typeof value.records === "object" ? value : { records: {} };
}

function writeCanonicalMeta(meta) {
  globalThis.localStorage?.setItem(canonicalMetaKey(), JSON.stringify(meta || { records: {} }));
}

function canonicalStamp(value, fallback = new Date().toISOString()) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function canonicalDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function stableId(prefix, seed) {
  const raw = String(seed || "");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) { hash ^= raw.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return prefix + "_" + (hash >>> 0).toString(36);
}

function ensureDbIdentities(localDb) {
  const db = localDb && typeof localDb === "object" ? localDb : {};
  db.sessions = db.sessions && typeof db.sessions === "object" ? db.sessions : {};
  Object.entries(db.sessions).forEach(([key, session]) => {
    if (session && typeof session === "object" && !session.id && !session.sessionId) session.id = key;
  });
  db.checkins = Array.isArray(db.checkins) ? db.checkins : [];
  db.checkins.forEach((item, index) => {
    if (item && typeof item === "object" && !item.id) item.id = stableId("checkin", (item.createdAt || item.date || "") + "|" + index);
  });
  db.nutrition = db.nutrition && typeof db.nutrition === "object" ? db.nutrition : {};
  db.nutrition.entries = Array.isArray(db.nutrition.entries) ? db.nutrition.entries : [];
  db.nutrition.entries.forEach((item, index) => {
    if (item && typeof item === "object" && !item.id) item.id = stableId("nutrition", (item.date || "") + "|" + (item.name || "") + "|" + index);
  });
  db.nutrition.dailySummaries = Array.isArray(db.nutrition.dailySummaries) ? db.nutrition.dailySummaries : [];
  db.nutrition.dailySummaries.forEach((item, index) => {
    if (item && typeof item === "object" && !item.id) item.id = stableId("summary", item.date || index);
  });
  db.recoveryActivities = Array.isArray(db.recoveryActivities) ? db.recoveryActivities : [];
  db.recoveryActivities.forEach((item, index) => {
    if (item && typeof item === "object" && !item.id) item.id = stableId("recovery", (item.performedDate || item.date || "") + "|" + (item.type || "") + "|" + index);
  });
  return db;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (key !== "cloudSyncedAt" && key !== "_canonical" && key !== "syncState") out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function fingerprint(value) {
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

function recordKey(row) {
  return String(row.record_type) + ":" + String(row.source_record_id);
}

export function isStandaloneWarmupSession(session, sourceRecordId = "") {
  const id = String(sourceRecordId || session?.id || session?.sessionId || "").trim();
  return id.startsWith("warm_")
    || session?.type === "warmup"
    || session?.warmupChild === true
    || session?.recordType === "warmup"
    || session?.sessionType === "warmup";
}

function canonicalRecordsFromDb(localDb, meta = readCanonicalMeta()) {
  const db = ensureDbIdentities(localDb);
  const records = [];
  const now = new Date().toISOString();
  const add = (recordType, sourceRecordId, payload, occurredOn, updatedAt, localRef) => {
    if (!payload || !sourceRecordId) return;
    const key = recordType + ":" + String(sourceRecordId);
    const fp = fingerprint(payload);
    const previous = meta.records[key];
    const unchanged = previous && previous.fingerprint === fp && !previous.deleted;
    let stamp = unchanged ? previous.updated_at : canonicalStamp(updatedAt, now);
    if (!unchanged && previous && (Date.parse(stamp) || 0) <= (Date.parse(previous.updated_at || "") || 0)) stamp = now;
    records.push({
      record_type: recordType,
      source_record_id: String(sourceRecordId),
      occurred_on: canonicalDate(occurredOn),
      payload,
      updated_at: stamp,
      localRef,
      _fingerprint: fp
    });
  };
  Object.entries(db.sessions).forEach(([key, session]) => {
    // Warm-up child/legacy rows are embedded set data, never standalone workout sessions.
    if (isStandaloneWarmupSession(session, key)) return;
    add("workout_session", session?.id || session?.sessionId || key, session, session?.performedDate || session?.date || session?.finished || session?.endedAt, session?.updatedAt || session?.finished || session?.endedAt, session);
  });
  db.checkins.forEach((item, index) => add("checkin", item?.id || item?.sourceRecordId || stableId("checkin", item?.createdAt || item?.date || index), item, item?.date || item?.createdAt, item?.updatedAt || item?.createdAt || item?.date, item));
  db.nutrition.entries.forEach((item, index) => add("nutrition_entry", item?.id || item?.sourceRecordId || stableId("nutrition", index), item, item?.date, item?.updatedAt || item?.createdAt || item?.date, item));
  db.nutrition.dailySummaries.forEach((item, index) => add("nutrition_summary", item?.id || item?.sourceSummaryId || stableId("summary", item?.date || index), item, item?.date, item?.updatedAt || item?.createdAt || item?.date, item));
  if (db.nutrition.targets && typeof db.nutrition.targets === "object") add("nutrition_target", "default", db.nutrition.targets, null, db.nutrition.targets.updatedAt || db.nutrition.targets.createdAt, db.nutrition.targets);
  db.recoveryActivities.forEach((item, index) => add("recovery_activity", item?.id || stableId("recovery", index), item, item?.performedDate || item?.date, item?.updatedAt || item?.createdAt || item?.performedDate || item?.date, item));
  if (db.coachSync && typeof db.coachSync === "object") add("coaching_state", "state", db.coachSync, null, db.coachSync.updatedAt || db.coachSync.createdAt, db.coachSync);
  const programState = canonicalProgramState || globalThis.__BT_PROGRAM_STATE__ || db.programState || (db.nextWeekProgram ? { schemaVersion: 1, source: "app", currentProgram: db.nextWeekProgram } : null);
  if (programState) add("program_state", "current", programState, null, programState.updatedAt, programState);
  const present = new Set(records.map(recordKey));
  Object.entries(meta.records || {}).forEach(([key, previous]) => {
    if (present.has(key) || previous.deleted || (key.startsWith("workout_session:warm_"))) return;
    const split = key.indexOf(":");
    if (split < 0) return;
    records.push({
      record_type: key.slice(0, split),
      source_record_id: key.slice(split + 1),
      occurred_on: null,
      payload: { __deleted: true },
      updated_at: now,
      _fingerprint: "deleted"
    });
  });
  return records;
}

async function upsertCanonicalRecords(rows) {
  if (!rows.length) return [];
  return request("user_data_records?on_conflict=user_id%2Crecord_type%2Csource_record_id", {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(rows.map(({ localRef, _fingerprint, ...row }) => row))
  });
}

function markCanonicalSynced(rows, stamp, meta) {
  rows.forEach(row => {
    const key = recordKey(row);
    meta.records[key] = {
      fingerprint: row._fingerprint || fingerprint(row.payload),
      updated_at: row.updated_at || stamp,
      deleted: Boolean(row.payload && row.payload.__deleted)
    };
    if (row.localRef && typeof row.localRef === "object") {
      row.localRef.cloudSyncedAt = stamp;
    }
  });
}

function mergeRowsByKey(current, queued) {
  const byKey = new Map();
  (current || []).forEach(row => byKey.set(recordKey(row), row));
  (queued || []).forEach(row => {
    const key = recordKey(row);
    const existing = byKey.get(key);
    if (!existing || (Date.parse(row.updated_at || "") || 0) >= (Date.parse(existing.updated_at || "") || 0)) byKey.set(key, row);
  });
  return [...byKey.values()];
}

async function syncLocalDbInternal(localDb, { skipQueue = false } = {}) {
  if (!sessionActive()) {
    setSyncStatus("sign-in-needed", "Sign in to sync");
    return { skipped: true, sessions: 0, checkins: 0, records: 0, status: "sign-in-needed" };
  }
  const user = currentUser();
  if (!user?.id) {
    setSyncStatus("sign-in-needed", "Sign in to sync");
    return { skipped: true, sessions: 0, checkins: 0, records: 0, status: "sign-in-needed" };
  }
  const db = ensureDbIdentities(localDb);
  const meta = readCanonicalMeta();
  const current = canonicalRecordsFromDb(db, meta);
  const queued = skipQueue ? [] : readCanonicalQueue();
  const queuedKeys = new Set(queued.map(recordKey));
  const changed = current.filter(row => queuedKeys.has(recordKey(row)) || !meta.records[recordKey(row)] || meta.records[recordKey(row)].deleted || meta.records[recordKey(row)].fingerprint !== row._fingerprint);
  const rows = mergeRowsByKey(changed, queued).map(row => ({ ...row, user_id: user.id }));
  if (!rows.length) {
    setSyncStatus("synced", "Synced to cloud");
    return { skipped: false, sessions: 0, checkins: 0, records: 0, offline: false, status: "synced" };
  }
  setSyncStatus("syncing", "Syncing…");
  try {
    await upsertCanonicalRecords(rows);
    const stamp = new Date().toISOString();
    markCanonicalSynced(rows, stamp, meta);
    writeCanonicalMeta(meta);
    if (!skipQueue) writeCanonicalQueue([]);
    setSyncStatus("synced", "Synced to cloud");
    return {
      skipped: false,
      sessions: rows.filter(row => row.record_type === "workout_session").length,
      checkins: rows.filter(row => row.record_type === "checkin").length,
      records: rows.length,
      offline: false,
      status: "synced"
    };
  } catch (error) {
    const authFailure = error?.code === "AUTH_REQUIRED" || /\b401\b|sign-in required/i.test(error?.message || "");
    if (!skipQueue) writeCanonicalQueue(rows.map(({ localRef, ...row }) => row));
    setSyncStatus(authFailure ? "sign-in-needed" : "pending", authFailure ? "Sign in to sync" : "Saved offline — will retry");
    return {
      skipped: false,
      sessions: 0,
      checkins: 0,
      records: rows.length,
      offline: true,
      status: authFailure ? "sign-in-needed" : "pending",
      errorCode: authFailure ? "AUTH_REQUIRED" : "SYNC_UNAVAILABLE",
      error: error?.message || "Sync unavailable"
    };
  }
}

function localRecordStamp(record) {
  return Date.parse(record?.updatedAt || record?.createdAt || record?.finished || record?.endedAt || record?.startedAt || record?.date || "") || 0;
}

function localRowFor(db, row) {
  const id = String(row.source_record_id || "");
  if (row.record_type === "workout_session") {
    const key = Object.keys(db.sessions || {}).find(k => String(db.sessions[k]?.id || db.sessions[k]?.sessionId || k) === id);
    return key ? db.sessions[key] : null;
  }
  const list = row.record_type === "checkin" ? db.checkins
    : row.record_type === "nutrition_entry" ? db.nutrition.entries
    : row.record_type === "nutrition_summary" ? db.nutrition.dailySummaries
    : row.record_type === "recovery_activity" ? db.recoveryActivities : null;
  if (list) return list.find(item => String(item?.id || item?.sourceRecordId || "") === id) || null;
  if (row.record_type === "nutrition_target") return db.nutrition.targets || null;
  if (row.record_type === "coaching_state") return db.coachSync || null;
  if (row.record_type === "program_state") return db.programState || null;
  return null;
}

function removeLocalRow(db, row) {
  const id = String(row.source_record_id || "");
  if (row.record_type === "workout_session") {
    Object.keys(db.sessions || {}).forEach(key => {
      if (String(db.sessions[key]?.id || db.sessions[key]?.sessionId || key) === id) delete db.sessions[key];
    });
    return;
  }
  const list = row.record_type === "checkin" ? db.checkins
    : row.record_type === "nutrition_entry" ? db.nutrition.entries
    : row.record_type === "nutrition_summary" ? db.nutrition.dailySummaries
    : row.record_type === "recovery_activity" ? db.recoveryActivities : null;
  if (list) {
    for (let i = list.length - 1; i >= 0; i--) if (String(list[i]?.id || list[i]?.sourceRecordId || "") === id) list.splice(i, 1);
  } else if (row.record_type === "nutrition_target") delete db.nutrition.targets;
  else if (row.record_type === "coaching_state") delete db.coachSync;
  else if (row.record_type === "program_state") delete db.programState;
}

function mergeRecord(local, row) {
  const cloud = row?.payload;
  if (!cloud || typeof cloud !== "object" || cloud.__deleted) return local;
  const merged = JSON.parse(JSON.stringify(cloud));
  merged.cloudSyncedAt = row.updated_at || new Date().toISOString();
  return merged;
}

export function mergeCanonicalRecords(localDb, rows = [], options = {}) {
  const merged = ensureDbIdentities(localDb && typeof localDb === "object" ? localDb : {});
  const meta = readCanonicalMeta();
  const pending = options.pendingRows || readCanonicalQueue();
  const pendingByKey = new Map(pending.map(row => [recordKey(row), row]));
  (Array.isArray(rows) ? rows : []).forEach(row => {
    // Ignore historical warm-up child rows on rehydration without deleting them.
    if (row.record_type === "workout_session" && isStandaloneWarmupSession(row.payload, row.source_record_id)) return;
    const key = recordKey(row);
    const pendingRow = pendingByKey.get(key);
    const cloudStamp = Date.parse(row.updated_at || "") || 0;
    const pendingStamp = Date.parse(pendingRow?.updated_at || "") || 0;
    const local = localRowFor(merged, row);
    const localFp = local ? fingerprint(local) : null;
    const known = meta.records[key];
    if (known?.deleted && cloudStamp <= (Date.parse(known.updated_at || "") || 0)) return;
    if (!known && local && !pendingRow && localRecordStamp(local) >= cloudStamp) return;
    const localDirty = Boolean(local && known && !known.deleted && known.fingerprint !== localFp);
    if (pendingRow && pendingStamp >= cloudStamp) return;
    if (localDirty) return;
    if (row.payload && row.payload.__deleted) {
      removeLocalRow(merged, row);
      meta.records[key] = { fingerprint: "deleted", updated_at: row.updated_at || new Date().toISOString(), deleted: true };
      return;
    }
    const value = mergeRecord(local, row);
    if (!value) return;
    if (row.record_type === "workout_session") {
      const id = String(row.source_record_id);
      const keyInDb = Object.keys(merged.sessions).find(k => String(merged.sessions[k]?.id || merged.sessions[k]?.sessionId || k) === id) || id;
      merged.sessions[keyInDb] = value;
    } else if (row.record_type === "checkin") {
      const i = merged.checkins.findIndex(item => String(item?.id || item?.sourceRecordId || "") === String(row.source_record_id));
      if (i >= 0) merged.checkins.splice(i, 1, value); else merged.checkins.push(value);
    } else if (row.record_type === "nutrition_entry") {
      const i = merged.nutrition.entries.findIndex(item => String(item?.id || item?.sourceRecordId || "") === String(row.source_record_id));
      if (i >= 0) merged.nutrition.entries.splice(i, 1, value); else merged.nutrition.entries.push(value);
    } else if (row.record_type === "nutrition_summary") {
      const i = merged.nutrition.dailySummaries.findIndex(item => String(item?.id || item?.sourceRecordId || "") === String(row.source_record_id));
      if (i >= 0) merged.nutrition.dailySummaries.splice(i, 1, value); else merged.nutrition.dailySummaries.push(value);
    } else if (row.record_type === "nutrition_target") merged.nutrition.targets = value;
    else if (row.record_type === "recovery_activity") {
      const i = merged.recoveryActivities.findIndex(item => String(item?.id || item?.sourceRecordId || "") === String(row.source_record_id));
      if (i >= 0) merged.recoveryActivities.splice(i, 1, value); else merged.recoveryActivities.push(value);
    } else if (row.record_type === "coaching_state") merged.coachSync = value;
    else if (row.record_type === "program_state") {
      merged.programState = value;
      const plan = value.currentProgram || value.nextWeekProgram;
      if (plan) merged.nextWeekProgram = plan;
    }
    meta.records[key] = { fingerprint: fingerprint(value), updated_at: row.updated_at || new Date().toISOString(), deleted: false };
  });
  writeCanonicalMeta(meta);
  return merged;
}

export async function pullCanonicalRecords() {
  if (!sessionActive()) return [];
  return request("user_data_records?select=record_type,source_record_id,payload,updated_at,occurred_on&order=updated_at.asc");
}

export async function rehydrateLocalDb(localDb) {
  if (!sessionActive()) return localDb;
  if (rehydrateInFlight) return rehydrateInFlight;
  rehydrateInFlight = (async () => {
    const db = ensureDbIdentities(localDb);
    try {
      const rows = await pullCanonicalRecords();
      const merged = mergeCanonicalRecords(db, Array.isArray(rows) ? rows : [], { pendingRows: readCanonicalQueue() });
      await syncLocalDbInternal(merged);
      return merged;
    } catch (error) {
      if (error?.code === "AUTH_REQUIRED") setSyncStatus("sign-in-needed", "Sign in to sync");
      else setSyncStatus("pending", "Saved offline — will retry");
      return db;
    } finally {
      rehydrateInFlight = null;
    }
  })();
  return rehydrateInFlight;
}

export function syncLocalDb(localDb) {
  latestSyncDb = localDb;
  if (syncInFlight) {
    syncRequested = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    let result;
    do {
      syncRequested = false;
      result = await syncLocalDbInternal(latestSyncDb);
    } while (syncRequested);
    return result;
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

export function listCoachUpdateRequests(query = "select=*&status=in.(submitted,approved)&order=updated_at.desc") {
  return request("coaching_update_requests?" + query);
}

export function getCoachUpdateRequest(id) {
  return request("coaching_update_requests?id=eq." + encodeURIComponent(id) + "&select=*");
}

export function reviewCoachUpdateRequest(id, { status, reviewedAt = null, appliedAt = null, expectedVersion = null } = {}) {
  const allowed = new Set(["approved", "rejected", "applied"]);
  if (!allowed.has(status)) throw new Error("Invalid coach update review status");
  const version = Number(expectedVersion);
  if (!Number.isInteger(version) || version < 1) throw new Error("A current coach-update version is required.");
  const patch = { status, request_version: version + 1 };
  if (reviewedAt) patch.reviewed_at = reviewedAt;
  if (appliedAt) patch.applied_at = appliedAt;
  const filter = "&request_version=eq." + encodeURIComponent(String(version));
  return request("coaching_update_requests?id=eq." + encodeURIComponent(id) + filter, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch)
  }).then(rows => {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Coach update changed elsewhere. Refresh and review the latest version.");
    return rows;
  });
}

export function appendCoachUpdateAudit(event) {
  const value = event && typeof event === "object" ? event : {};
  const allowed = ["request_id", "user_id", "event_type", "actor_type", "actor_client_id", "details"];
  const payload = {};
  allowed.forEach(key => { if (value[key] !== undefined) payload[key] = value[key]; });
  return request("coaching_update_audit", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });
}

function storagePath(path) {
  return String(path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function storageRequest(path, options = {}, retryAuth = true) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  const response = await fetch(projectUrl + "/storage/v1/" + path, {
    ...options,
    headers: { ...(await authHeaders()), ...(options.body instanceof Blob ? { "Content-Type": options.body.type || "application/octet-stream" } : {}), ...(options.headers || {}) }
  });
  if (response.status === 401 && retryAuth && readSession().refresh_token) {
    await refreshSession({ force: true });
    return storageRequest(path, options, false);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Supabase storage request failed (" + response.status + "): " + detail);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

export function uploadProgressPhoto(path, blob) {
  return storageRequest("object/progress-photos/" + storagePath(path), { method: "POST", headers: { "x-upsert": "false" }, body: blob });
}

export async function createProgressPhotoSignedUrl(path, expiresIn = 3600) {
  const payload = await storageRequest("object/sign/progress-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn, paths: [path] }) });
  const normalize = value => typeof value === "string" && value.startsWith("/") ? projectUrl + value : value;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.signedURL) return { ...payload, signedURL: normalize(payload.signedURL) };
  if (Array.isArray(payload)) return payload.map(item => item?.signedURL ? { ...item, signedURL: normalize(item.signedURL) } : item);
  return payload;
}

export function deleteProgressPhotoObject(path) {
  return storageRequest("object/progress-photos/" + storagePath(path), { method: "DELETE" });
}

export function listProgressPhotoMetadata(query = "select=*&order=week_start.desc") {
  return request("progress_photos?" + query);
}

export function upsertProgressPhotoMetadata(metadata) {
  return request("progress_photos?on_conflict=user_id%2Cweek_start%2Cangle", { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(metadata) });
}

export function deleteProgressPhotoMetadata(id) {
  return request("progress_photos?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
