const config = globalThis.__BT_CONFIG__ || {
  supabaseUrl: "https://ncvtnlrogpngaelqgvvt.supabase.co",
  supabaseAnonKey: "sb_publishable_Omsxr2yIpZG8krgJfZql7A_DPfJnIHW"
};
const projectUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
const publishableKey = String(config.supabaseAnonKey || "");
const sessionKey = "bt_supabase_session";
let syncInFlight = null;

export const supabaseConfigured = Boolean(projectUrl && publishableKey);

async function request(path, options = {}) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${JSON.parse(localStorage.getItem(sessionKey) || "null")?.access_token || publishableKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

export function listOwnSessions(query = "select=*&order=occurred_on.desc") {
  return request(`workout_sessions?${query}`);
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
  const response = await fetch(`${projectUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.msg || "Sign-in failed");
  localStorage.setItem(sessionKey, JSON.stringify(payload));
  return payload.user;
}

export function signOut() {
  localStorage.removeItem(sessionKey);
}

export function currentUser() {
  return JSON.parse(localStorage.getItem(sessionKey) || "null")?.user || null;
}

export function sessionActive() {
  return Boolean(JSON.parse(localStorage.getItem(sessionKey) || "null")?.access_token);
}


async function syncLocalDbInternal(localDb) {
  if (!sessionActive()) return { skipped: true, sessions: 0, checkins: 0 };
  const user = currentUser();
  if (!user?.id) return { skipped: true, sessions: 0, checkins: 0 };
  let sessions = 0, checkins = 0;
  for (const checkin of localDb.checkins || []) {
    if (checkin.syncedAt) continue;
    await request("body_checkins", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: user.id,
        recorded_at: checkin.createdAt || new Date().toISOString(),
        weight: Number(checkin.weight) || null,
        weight_unit: "lb",
        waist: Number(checkin.waist) || null,
        waist_unit: "in",
        notes: checkin.notes || null
      })
    });
    checkin.syncedAt = new Date().toISOString();
    checkins++;
  }
  for (const session of Object.values(localDb.sessions || {})) {
    if (!session.finished || session.cloudSyncedAt) continue;
    const sourceId = `${session.date || ""}_${session.day || ""}`;
    const [created] = await request("workout_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        source: "manual",
        source_record_id: sourceId,
        occurred_on: session.date,
        started_at: session.started || null,
        finished_at: session.finished,
        status: "completed"
      })
    });
    const sessionId = created?.id;
    if (sessionId) {
      for (const exercise of Object.values(session.exercises || {})) {
        const [remoteExercise] = await request("workout_exercises", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            session_id: sessionId,
            exercise_name_snapshot: exercise.name,
            position: 1,
            planned_sets: exercise.planned?.sets || null,
            min_reps: exercise.planned?.min || null,
            max_reps: exercise.planned?.max || null
          })
        });
        if (!remoteExercise?.id) continue;
        for (const [index, set] of (exercise.actual || []).entries()) {
          if (!set.done) continue;
          await request("workout_sets", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              workout_exercise_id: remoteExercise.id,
              position: index + 1,
              kind: "working",
              weight: Number(set.weight) || null,
              weight_unit: "lb",
              reps: Number(set.reps) || null,
              feel: String(set.feel || "").toLowerCase() || null,
              completed_at: session.finished
            })
          });
        }
      }
    }
    session.cloudSyncedAt = new Date().toISOString();
    sessions++;
  }
  localStorage.setItem("bt10_db", JSON.stringify(localDb));
  return { skipped: false, sessions, checkins };
}


export function syncLocalDb(localDb) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncLocalDbInternal(localDb).finally(() => { syncInFlight = null; });
  return syncInFlight;
}
