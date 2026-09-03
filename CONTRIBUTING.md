# Development workflow

## Branches

- `main`: production and always deployable.
- `feature/<short-name>`: product work.
- `fix/<short-name>`: defect fixes.
- `chore/<short-name>`: tooling, documentation, or maintenance.

Use short-lived branches. Do not maintain a permanent development branch.

## Pull requests

Each pull request should be bounded, reviewable, and reversible. It must describe:

- user outcome and affected screens;
- data-model or migration impact;
- tests added or changed;
- phone verification at 390 × 844;
- rollback considerations.

Run `npm run ci` before opening or updating a pull request. Production behavior must not be changed through an unreviewed direct push.

## Release gates

A release is blocked by failures involving workout/session persistence, review-before-save, warm-up separation, duration, Coach Sync validation/cutoffs, nutrition history, authentication, or data migration. Cosmetic issues are triaged by user impact but do not justify bypassing checks.

## Data safety

- Never rewrite historical `programSnapshot` data.
- Never use `0` for unknown measurements.
- Database changes require a new forward migration; never edit an applied migration.
- Code rollback must not delete or roll back user records.
- Export/backup production data before a risky migration.
- Keep service-role keys and AI credentials out of the browser bundle.

## Commit and release naming

Use concise outcome-oriented commits. Releases follow semantic versioning: patch for safe fixes, minor for backward-compatible features, major for incompatible data or behavior changes.
