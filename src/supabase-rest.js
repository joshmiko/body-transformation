const config = globalThis.__BT_CONFIG__ || {};
const projectUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
const publishableKey = String(config.supabaseAnonKey || "");

export const supabaseConfigured = Boolean(projectUrl && publishableKey);

async function request(path, options = {}) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
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
