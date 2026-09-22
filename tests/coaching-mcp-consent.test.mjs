import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSignInReturnUrl, readConsentParams, safeClientSummary, redirectUrlFromApproval, classifyAuthorizationDetails, safeOAuthError, safeIdentityLabel, validateCompletionUrl, isStaleAuthorizationError, getAuthorizationDetailsOnce, accountIdentity, sameAccount } from "../oauth/consent.mjs";

test("consent requires authorization_id and preserves it through sign-in fallback", () => {
  assert.throws(() => readConsentParams("?state=abc"), /authorization_id/);
  const parsed = readConsentParams("?authorization_id=auth_123");
  assert.equal(parsed.authorizationId, "auth_123");
  const returnUrl = buildSignInReturnUrl("https://joshmiko.github.io/body-transformation/oauth/consent.html?authorization_id=auth_123");
  const url = new URL(returnUrl);
  assert.equal(url.searchParams.get("oauth_return"), "https://joshmiko.github.io/body-transformation/oauth/consent.html?authorization_id=auth_123");
});

test("consent summary is bounded and contains no credential material", () => {
  const summary = safeClientSummary({ client_name: "ChatGPT", redirect_uri: "https://chatgpt.com/callback?code=private", scopes: ["read:coaching", "x".repeat(500)] });
  assert.equal(summary.name, "ChatGPT");
  assert.equal(summary.origin, "https://chatgpt.com");
  assert.ok(summary.scopes.every(scope => scope.length <= 80));
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.equal(safeClientSummary({ client: { name: "Body Transformation Coach — Codex" } }).name, "Body Transformation Coach — Codex");
  assert.equal(safeClientSummary({}).name, "Coaching assistant");
});

test("static consent route accurately describes read and proposed-update access without exposing tokens", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  for (const marker of ["authorization_id", "getAuthorizationDetails", "approveAuthorization", "denyAuthorization", "Keep", "create and submit proposed coach updates", "in-app review", "cannot apply a program change"]) {
    assert.ok(html.includes(marker), "missing " + marker);
  }
  assert.equal(/read-only access|write actions are not included|ChatGPT is requesting/i.test(html), false);
  assert.equal(/access_token|refresh_token|service_role/i.test(html), false);
});

test("signed-out consent registers sign-in before the initial session check can return", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  const handler = html.indexOf('signInForm.addEventListener("submit"');
  const initialLoad = html.indexOf("loadRequest().catch");
  const signedOutReturn = html.indexOf('status("Sign in is required before you can review access.")');
  assert.ok(handler > signedOutReturn, "sign-in handler should be registered outside loadRequest");
  assert.ok(handler < initialLoad, "sign-in handler must exist before the initial request load");
  assert.equal((html.match(/createClient\(/g)||[]).length,1,"reuse one Supabase client through sign-in");
  assert.match(html,/signInWithPassword/);
  assert.match(html,/await loadRequest\(\)/);
});

test("OAuth completion accepts registered HTTPS and localhost callbacks", () => {
  const https = "https://chatgpt.com/callback?code=abc123&state=xyz";
  const local = "http://localhost:3000/oauth/callback?code=abc123";
  assert.equal(redirectUrlFromApproval({ data: { redirect_url: https } }), https);
  assert.equal(redirectUrlFromApproval({ data: { redirect_url: local } }), local);
  assert.deepEqual(classifyAuthorizationDetails({ authorization_id: "auth_123", client: { name: "ChatGPT" } }).kind, "consent");
  assert.deepEqual(classifyAuthorizationDetails({ redirect_url: local }).kind, "redirect");
  assert.throws(() => validateCompletionUrl("javascript:alert(1)"), /unsafe completion URL/);
  assert.throws(() => validateCompletionUrl("http://evil.example/callback"), /unsafe completion URL/);
});

test("OAuth Supabase errors are surfaced without leaking callback credentials", () => {
  assert.throws(
    () => redirectUrlFromApproval({ error: { message: "authorization failed code=secret-code access_token=secret-token" } }),
    error => error.message.includes("authorization failed") &&
      !error.message.includes("secret-code") &&
      !error.message.includes("secret-token")
  );
  assert.throws(() => redirectUrlFromApproval({ data: {} }), /completion URL/);
  assert.equal(safeOAuthError({ message: "request failed https://client.example/callback?code=private-code" }).includes("private-code"), false);
});

test("already-approved OAuth responses redirect safely rather than silently approving", () => {
  const result = classifyAuthorizationDetails({ redirect_url: "https://chatgpt.com/callback?code=already-approved" });
  assert.equal(result.kind, "redirect");
  assert.equal(result.redirectUrl.startsWith("https://chatgpt.com/"), true);
  assert.equal(classifyAuthorizationDetails({ authorization_id: "auth_123" }).kind, "consent");
});

test("consent identifies the signed-in account and offers local account switching", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  assert.match(html, /Signed in as/);
  assert.match(html, /safeIdentityLabel/);
  assert.match(html, /signOut\(\{ scope: "local" \}\)/);
  assert.match(html, /Use another account/);
  assert.equal(safeIdentityLabel({ user: { email: "testuser@example.com" } }), "testuser@example.com");
  assert.equal(safeIdentityLabel({ user: { id: "opaque-id" } }), "Signed-in account");
});

test("consent source never prints authorization codes or tokens in user-facing error paths", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  assert.match(html, /safeOAuthError/);
  assert.doesNotMatch(html, /textContent\s*=\s*error\.message/);
  assert.doesNotMatch(html, /innerHTML\s*=\s*.*redirect_url/);
  assert.equal(/access_token|refresh_token|client_secret|authorization_code/.test(html), false);
});

test("already-approved response requires explicit account confirmation before redirect", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  const result = classifyAuthorizationDetails({ redirect_url: "https://chatgpt.com/callback?code=already-approved" });
  assert.equal(result.kind, "redirect");
  assert.match(html, /id="continue-approved"/);
  assert.match(html, /Review the signed-in account before continuing/);
  assert.match(html, /continueApprovedButton\.onclick/);
  assert.match(html, /Continue as /);
});

test("sign-in and load failures use the same redacted error path", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  assert.match(html, /safeOAuthError\(signInError/);
  assert.match(html, /safeOAuthError\(error, "Unable to load authorization/);
  assert.doesNotMatch(html, /status\(signInError\.message/);
  assert.doesNotMatch(html, /status\(error\.message/);
  assert.match(html, /other devices remain signed in/);
});

test("account confirmation gates authorization-details lookup", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  const loadStart = html.indexOf("async function loadRequest()");
  const loadEnd = html.indexOf("\nswitchAccountButton.addEventListener", loadStart);
  const loadBody = html.slice(loadStart, loadEnd);
  assert.match(loadBody, /confirmAccountButton\.onclick/);
  assert.doesNotMatch(loadBody, /getAuthorizationDetails/);
  assert.doesNotMatch(loadBody, /approveAuthorization/);
  assert.doesNotMatch(loadBody, /denyAuthorization/);
  const detailStart = html.indexOf("async function loadAuthorizationDetails()");
  const detailEnd = html.indexOf("\n\nasync function loadRequest()", detailStart);
  assert.match(html.slice(detailStart, detailEnd), /getAuthorizationDetails/);
});

test("account switching preserves the request and stale authorizations stop with a restart message", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  assert.match(html, /signOut\(\{ scope: "local" \}\)/);
  assert.match(html, /await loadRequest\(\)/);
  assert.match(html, /This authorization link is expired or already processed/);
  assert.equal(isStaleAuthorizationError({ message: "OAuth authorization request expired" }), true);
  assert.equal(isStaleAuthorizationError({ message: "temporary network failure" }), false);
  assert.match(html, /authorization_id/);
});

test("stale authorization matcher covers Supabase processing-state failures", () => {
  assert.equal(isStaleAuthorizationError({ message: "authorization request cannot be processed" }), true);
});

test("pre-confirm switch then new-account confirmation performs one details lookup", async () => {
  const calls = [];
  const client = { auth: { oauth: { getAuthorizationDetails: async id => { calls.push(id); return { data: { authorization_id: id } }; } } } };
  const state = { accountConfirmed: false, detailsLookupStarted: false };
  await assert.rejects(() => getAuthorizationDetailsOnce(client, "auth_new_user", state), /Confirm the signed-in account/);
  state.accountConfirmed = true;
  await getAuthorizationDetailsOnce(client, "auth_new_user", state);
  await assert.rejects(() => getAuthorizationDetailsOnce(client, "auth_new_user", state), /already started/);
  assert.deepEqual(calls, ["auth_new_user"]);
});

test("session mismatch returns to account choice without performing a lookup", async () => {
  const calls = [];
  const client = { auth: { oauth: { getAuthorizationDetails: async id => { calls.push(id); return { data: { authorization_id: id } }; } } } };
  const state = { accountConfirmed: true, detailsLookupStarted: false };
  assert.equal(accountIdentity({ user: { id: "account-a" } }), "account-a");
  assert.equal(sameAccount("account-a", { user: { id: "account-a" } }), true);
  assert.equal(sameAccount("account-a", { user: { id: "account-b" } }), false);
  state.accountConfirmed = false;
  await assert.rejects(() => getAuthorizationDetailsOnce(client, "auth_after_mismatch", state), /Confirm the signed-in account/);
  assert.deepEqual(calls, []);
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  assert.match(html, /signed-in account changed/);
  assert.match(html, /sameAccount\(lookupState\.accountKey/);
  assert.match(html, /confirmAccountButton\.textContent = "Account confirmed"/);
});
