const config = globalThis.__BT_CONFIG__ || {};
const projectUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
const publishableKey = String(config.supabaseAnonKey || "");
const sessionKey = "bt_supabase_session";

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
