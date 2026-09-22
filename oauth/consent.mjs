export function readConsentParams(search = "") {
  const params = new URLSearchParams(String(search || ""));
  const authorizationId = String(params.get("authorization_id") || "").trim();
  if (!authorizationId || authorizationId.length > 200) throw new Error("This authorization request is missing its authorization_id.");
  return { authorizationId };
}

export function buildSignInReturnUrl(currentHref) {
  const current = new URL(String(currentHref));
  const target = new URL("../index.html", current);
  const consent = new URL(current.origin + current.pathname);
  const authorizationId = String(current.searchParams.get("authorization_id") || "").trim();
  if (authorizationId) consent.searchParams.set("authorization_id", authorizationId);
  target.searchParams.set("oauth_return", consent.toString());
  return target.toString();
}

export function safeOAuthError(error, fallback = "Supabase could not complete this authorization request.") {
  const raw = String(error?.message || error?.error_description || error || fallback).trim();
  if (!raw) return fallback;
  return raw
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .replace(/\b(access_token|refresh_token|client_secret|authorization_code|code|state)=\S+/gi, (_match, key) => key + "=[redacted]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[redacted]")
    .slice(0, 240);
}

export function validateCompletionUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Supabase did not return a completion URL.");
  let target;
  try { target = new URL(raw); } catch { throw new Error("Supabase returned an invalid completion URL."); }
  const protocol = target.protocol.toLowerCase();
  const host = target.hostname.toLowerCase();
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if ((protocol !== "https:" && !(protocol === "http:" && localHost)) || target.username || target.password) {
    throw new Error("Supabase returned an unsafe completion URL.");
  }
  return target.toString();
}

export function redirectUrlFromApproval(result) {
  if (result?.error) throw new Error(safeOAuthError(result.error, "Supabase could not complete this authorization request."));
  const data = result?.data || result || {};
  return validateCompletionUrl(data.redirect_url || data.redirectUrl);
}

export function classifyAuthorizationDetails(value) {
  const source = value?.data || value || {};
  if (source.authorization_id) return { kind: "consent", details: source };
  if (source.redirect_url || source.redirectUrl) return { kind: "redirect", redirectUrl: validateCompletionUrl(source.redirect_url || source.redirectUrl), details: source };
  return { kind: "invalid", details: source };
}

export function safeClientSummary(details) {
  const source = details?.data || details || {};
  const name = String(source.client?.name || source.client_name || source.clientName || source.application_name || "Coaching assistant").slice(0, 120);
  let origin = "";
  try {
    const raw = source.redirect_uri || source.redirectUri || source.redirect_url || "";
    if (raw) origin = new URL(raw).origin;
  } catch {}
  const scopeValue = source.scope || source.scopes || "";
  const scopes = Array.isArray(scopeValue)
    ? scopeValue.map(value => String(value).slice(0, 80)).slice(0, 12)
    : String(scopeValue).split(/\s+/).filter(Boolean).map(value => value.slice(0, 80)).slice(0, 12);
  return { name, origin, scopes };
}

export function isStaleAuthorizationError(error) {
  const text = String(error?.message || error?.error_description || error || "").toLowerCase();
  return /expired|already processed|already used|not found|not pending|invalid authorization|authorization request.*(invalid|missing|expired)/.test(text);
}

export function safeIdentityLabel(session) {
  const user = session?.user || session?.data?.user || session || {};
  const email = String(user.email || "").trim();
  if (email) return email.slice(0, 160);
  const phone = String(user.phone || "").trim();
  if (phone) return phone.slice(0, 80);
  return "Signed-in account";
}
