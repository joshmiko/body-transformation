import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSignInReturnUrl, readConsentParams, safeClientSummary } from "../oauth/consent.mjs";

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
});

test("static consent route keeps OAuth operations and does not contain tokens", async () => {
  const html = await readFile(new URL("../oauth/consent.html", import.meta.url), "utf8");
  for (const marker of ["authorization_id", "getAuthorizationDetails", "approveAuthorization", "denyAuthorization", "Keep"]) {
    assert.ok(html.includes(marker), "missing " + marker);
  }
  assert.equal(/access_token|refresh_token|service_role/i.test(html), false);
});
