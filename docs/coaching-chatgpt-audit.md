# ChatGPT coaching bridge access audit

## Findings

The deployed bridge is reachable and requires authentication. This cloud chat's measured failure is `401 MISSING_CREDENTIALS`, not evidence of a broken deployment. A synthetic invalid token is also rejected. No authenticated coaching connection or credentials are attached here, and no readable Codex MCP configuration exists in this runtime. Earlier desktop Codex registration does not register or authorize a regular ChatGPT app. This audit cannot inspect the user's ChatGPT account or desktop installation.

Two additional setup constraints were found:

1. Supabase's public authorization-server metadata advertises neither a DCR `registration_endpoint` nor CIMD support. ChatGPT needs a pre-registered OAuth client or an administrator must enable DCR and verify discovery. Whether a suitable ChatGPT client already exists is unverified; public metadata does not enumerate registered clients.
2. OpenAI's current documentation describes custom MCP connections as web-only, full write support for Business/Enterprise/Edu, and Pro as read/fetch-only. The user's plan/workspace and native iPhone availability remain unverified. Code cannot override account/platform restrictions.

These establish missing authorization here and a limitation for automatic client discovery. They do **not** establish a specific failed ChatGPT login, incorrect callback, or disabled dashboard toggle without an actual connection attempt or management access.

## Changes prepared

- Replaced misleading documentation describing the existing bridge as a separate staged/read-only branch with the six-tool architecture and ChatGPT/OAuth instructions.
- Made the expired-consent message refer to the user's coaching assistant instead of always directing them to Codex.
- No authentication, tool implementation, RLS policy, schema, active program or history changed. No Supabase dashboard change, migration, function deployment, OAuth-client registration, user consent or real coach submission was performed.

See the [setup guide](coaching-mcp.md). The consent-copy correction is a repository change; until merged and deployed through Pages, live copy remains unchanged.

## Measured live results

| Check | Result |
| --- | --- |
| MCP `initialize` without credentials | HTTP 401, `MISSING_CREDENTIALS`, Bearer `resource_metadata` challenge |
| MCP `tools/list` without credentials | HTTP 401; discovery is protected |
| `list_recent_workouts` without credentials | HTTP 401; no workout data returned |
| `tools/list` with a synthetic invalid token | HTTP 401, `INVALID_JWT` |
| Advertised protected-resource metadata | HTTP 200; resource matches the endpoint and issuer is this project's `/auth/v1` |
| OAuth authorization-server discovery | HTTP 200; authorization/token/JWKS URLs, PKCE `S256`, code/refresh grants, `offline_access` |
| OpenID discovery | HTTP 200; agrees with OAuth discovery |
| Public JWKS | HTTP 200; ES256/EC signing key advertised |
| Intended consent page | HTTP 200 at its GitHub Pages URL |
| Automatic client registration discovery | No DCR endpoint or CIMD support advertised |

Checks used the inherited proxy and TLS verification. No stored credentials were extracted. All MCP requests were discovery or protected read attempts; no production create/submit/apply calls were made.

## Remaining verification

| Requested behavior | Evidence and limit |
| --- | --- |
| OAuth login and refresh | Public discovery passes; authorized user/client needed for code exchange and refresh |
| All six tools discovered by ChatGPT | Six registrations/schemas exist in source; authorized live `tools/list` and ChatGPT scan not performed |
| Authenticated workout retrieval | Source is user-scoped and unsigned requests are denied; no live user workout was read |
| Draft creation/submission | Source requires OAuth client, confirmation, valid payload and queue writes; live accessibility not tested |
| Submission never activates a program | Repository code/contracts separate submission from app review/apply; deployed enforcement not tested with OAuth |
| Coach displays submitted updates | App queries submitted/approved requests and renders review controls; no live test update submitted |
| Two-user isolation | Repository RLS definitions exist; deployed two-user test unavailable |

`npm run ci` passed static verification and all 215 tests, with zero failed or skipped. Passing local tests does not upgrade the unverified live results above to passed.

## Connection status

Regular ChatGPT access has **not** been enabled or demonstrated by this audit. The owner must create/authorize the connection in a supported account/workspace and resolve OAuth client registration. Perform a read-only acceptance check first. Only after that, and explicit approval for the actual coaching proposal, use the queue tools and verify the app presents it for review.

Sources: [OpenAI availability and controls](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OpenAI OAuth registration](https://developers.openai.com/plugins/build/auth), [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [Supabase OAuth server/client setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
