export function readConsentParams(search = "") {
  const params = new URLSearchParams(String(search || ""));
  const authorizationId = String(params.get("authorization_id") || "").trim();
  if (!authorizationId || authorizationId.length > 200) throw new Error("This authorization request is missing its authorization_id.");
  return { authorizationId };
}

export function buildSignInReturnUrl(currentHref) {
  const target = new URL("../index.html", currentHref);
  target.searchParams.set("oauth_return", String(currentHref));
  return target.toString();
}

export function safeClientSummary(details) {
  const source = details?.data || details || {};
  const name = String(source.client?.name || source.client_name || source.clientName || source.application_name || "Coaching assistant").slice(0, 120);
  let origin = "";
  try {
    const raw = source.redirect_uri || source.redirectUri || source.redirect_url || "";
    if (raw) origin = new URL(raw).origin;
  } catch {}
  const scopes = Array.isArray(source.scopes) ? source.scopes.map(value => String(value).slice(0, 80)).slice(0, 12) : [];
  return { name, origin, scopes };
}

export function redirectUrlFromApproval(result) {
  const data = result?.data || result || {};
  const url = String(data.redirect_url || data.redirectUrl || "").trim();
  if (!url) throw new Error("Supabase did not return a safe completion URL.");
  return url;
}

