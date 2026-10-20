# Body Transformation coaching MCP

The existing authenticated bridge is the integration point for coaching. Registering it in Codex does **not** install it in regular ChatGPT. Each client needs its own connection and user authorization.

Endpoint:

```text
https://ncvtnlrogpngaelqgvvt.supabase.co/functions/v1/coaching-mcp
```

Use that complete URL. Do not append `/mcp`, switch authentication off, or put credentials in the URL. See the [access audit](coaching-chatgpt-audit.md) for measured results and verification limits.

## Tools and review boundary

| Tool | Capability |
| --- | --- |
| `list_recent_workouts` | Read bounded completed workouts |
| `get_workout` | Read one normalized workout and its recorded snapshot |
| `get_coaching_context` | Read bounded workout, nutrition, recovery, program and watermark context |
| `get_changes_since` | Read incremental changes with a cursor |
| `create_coach_update_draft` | Create an idempotent proposed update in the review queue |
| `submit_coach_update` | Submit an existing draft for review in the app |

The four read tools are annotated read-only. Both write tools require `confirm: true` and a verified OAuth `client_id`. The authenticated Supabase client enforces user RLS. Repository policies restrict OAuth writes to the review queue and audit events. No MCP tool applies a program, edits completed workouts, or replaces historical `programSnapshot` data.

Drafts use idempotency keys and payload hashes; optional coaching watermarks reject stale proposals. Submission changes a draft to `submitted`. Coach in the signed-in app lists submitted/approved requests and requires explicit review before application. ChatGPT's tool confirmation is separate from approval of a program in the app.

A `401` on unsigned MCP initialization or tool calls is expected: the challenge advertises OAuth discovery. An app login or publishable key alone does not authorize ChatGPT. Never paste browser sessions, bearer tokens, client secrets or service-role keys into a chat.

## Check ChatGPT eligibility first

[OpenAI's current documentation](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) describes custom MCP connections as **web-only**, full MCP/write support for Business and Enterprise/Edu, and Pro as read/fetch-only. Business creation/publishing requires an admin or owner; Enterprise/Edu can additionally delegate creation through RBAC. Check your account's current controls because availability changes.

Set up in **ChatGPT on the web**, not Codex's Plugins/MCP settings. Desktop setup does not prove native iPhone ChatGPT support. Safari is a possible web-client route only if it exposes the supported interface; native-app use remains unverified. A server change cannot override account or platform restrictions.

## Configure the existing OAuth server

The deployed metadata advertises PKCE `S256`, authorization-code/refresh grants and `offline_access`. During this audit it advertised **no `registration_endpoint` or CIMD support**. Automatic client registration is therefore not discoverable. This does not prove that a previously registered client is broken.

Public discovery URLs (safe to inspect without signing in):

- Protected resource: `https://ncvtnlrogpngaelqgvvt.supabase.co/functions/v1/coaching-mcp/oauth-protected-resource`.
- Authorization server: `https://ncvtnlrogpngaelqgvvt.supabase.co/auth/v1/.well-known/oauth-authorization-server`.

Choose one route:

1. **Pre-register a dedicated ChatGPT client.** In the Supabase project dashboard, open **Authentication → OAuth Server → OAuth Apps → Add a new client** (the clients list may appear directly on OAuth Server). Name it `Body Transformation Coach — ChatGPT`. Copy the **exact callback URI displayed by ChatGPT for this connection** into allowed redirect URIs. Do not guess an old callback, use wildcards, or reuse a localhost-only Codex redirect. Choose a client/authentication type supported by ChatGPT's OAuth fields. For a confidential client, place its secret only in ChatGPT's secure OAuth configuration. Discovery supports `client_secret_basic`, `client_secret_post`, and public clients using `none`.
2. **Or enable dynamic client registration.** In **Authentication → OAuth Server**, enable DCR, then verify discovery actually includes `registration_endpoint`. This permits other clients to register too; retain user consent and RLS. A repository edit cannot change that dashboard setting.

If ChatGPT does not expose the callback until a draft exists, inspect the draft's OAuth/management settings or use functioning DCR. Never invent a callback. See [Supabase client setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started) and [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).

Verify the existing consent configuration without unnecessarily changing the working app's Site URL:

- Intended Site URL: `https://joshmiko.github.io/body-transformation`.
- Intended relative Authorization Path: `/oauth/consent.html`.
- Combined consent URL: `https://joshmiko.github.io/body-transformation/oauth/consent.html`.
- This is **not** ChatGPT's callback. Supabase sends `authorization_id` to the consent page; approval returns to the client's separately registered callback.
- Preserve supported OIDC scopes requested by ChatGPT and `offline_access` when configuring refresh access. Scopes do not replace user/client RLS policies.

The public consent page is reachable, but its configured dashboard path, client callbacks and completed sign-in are unverified. This audit had no Supabase management credentials and made no dashboard changes.

## Connect in regular ChatGPT

1. Open `https://chatgpt.com` in a browser, select the intended account/workspace, and confirm creation/write permissions.
2. In the current interface, use **Plugins → + → Add custom MCP server**. Legacy interfaces use **Settings → Apps → Create** or workspace **Apps → Create**; enable Developer Mode only if that interface requires it. These controls belong to ChatGPT, not Codex.
3. Name it `Body Transformation Coach`, select a public HTTPS connection, enter the complete endpoint above, and keep **OAuth** authentication. Use the pre-registered client ID/secret in secure OAuth fields, or automatic registration if DCR is available.
4. Review the warning and create the plugin/app. Follow the OAuth prompt, sign in to **Body Transformation**, confirm the displayed account and client, and approve the connection. Restart from ChatGPT if an authorization link expires.
5. Complete **Scan Tools** if shown and verify all six tool names. A workspace may require an admin to publish the draft and enable both write actions. Refresh the tool list if ChatGPT retained an older four-tool snapshot.
6. Install/enable it. Start a new chat and select it with `@` or the available app picker. First request only a recent-workout read and confirm it belongs to your account. Do not submit a real proposal merely to test connectivity.

If creation or write actions are missing, resolve plan/workspace permissions first. Do not weaken bridge authentication or substitute a privileged key. An inaccessible native-iPhone custom-MCP interface does not establish that the server failed.

## Verification and deployment

- Run `npm run ci` for repository normalization, payload validation, consent and review/app contracts. Local tests do not prove deployed OAuth or production RLS.
- Use MCP Inspector or ChatGPT's scan with an authorized account for live initialization, `tools/list` and read calls. Keep only redacted evidence.
- Use designated test accounts and synthetic fixtures for live draft/submission/app-review and two-user isolation checks. Real coaching submissions require explicit approval.
- Do not rerun historical migrations or redeploy a working function because a client has no connection. Production function/migration state requires separate evidence.
- `verify_jwt = false` delegates gateway authentication to the existing `withOAuthProtectedResource()` and `withSupabase({ auth: "user" })` middleware; it does **not** make tools anonymous. Keep both middleware and RLS.
- No Supabase migration or function deployment was required or performed in this audit.

References: [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OpenAI OAuth guide](https://developers.openai.com/plugins/build/auth).
