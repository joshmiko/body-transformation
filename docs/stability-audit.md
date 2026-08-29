# Stability audit

## Current state

The application is a single `index.html` PWA-style page with inline CSS and JavaScript. It stores all data in `localStorage` under `bt10_db` and ships a hard-coded training program and historical summary.

## Keep

- The existing workout flow, training-program content, progression concept, setup notes, and structured coaching-payload idea are useful product behavior.
- The static PWA shell is a fine temporary presentation layer.

## Critical risks

1. **Data loss:** workout history, check-ins, notes, and sync state exist only in one browser profile. Browser storage clearing, device replacement, private browsing, quota failures, or malformed stored JSON can lose or block access to data.
2. **No synchronization:** “Sync” only copies JSON to the clipboard. It does not persist to a server, connect to Strong, or update ChatGPT automatically.
3. **No identity or access control:** there is no authentication, authorization, or separation between users.
4. **No recoverability:** no database, migrations, backups, audit trail, import idempotency, or export/restore process exists.
5. **Fragile architecture:** data model, program configuration, UI rendering, and business logic are all coupled inside a single global script with inline event handlers.
6. **No automated quality gate:** no package manifest, linting, type checking, tests, CI workflow, or deploy verification exists.
7. **Data quality gaps:** values are stored mostly as strings; there is no validation, canonical exercise identity, units model, or robust session lifecycle.

## Initial conclusion

Do not add new cosmetic features to this implementation. Preserve it as the UI/behavior reference while building a versioned, server-backed data foundation behind a controlled migration.
