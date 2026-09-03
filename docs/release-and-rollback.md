# Release and rollback runbook

## Release

1. Confirm the pull request is based on current `main`.
2. Require the Verify workflow to pass.
3. Review migrations and confirm a current data backup for any risky change.
4. Merge through the pull request.
5. Let the Pages workflow deploy the exact merged commit.
6. Confirm the deployment reports success.
7. Smoke-test production on an iPhone-sized viewport:
   - app boot and correct calendar day;
   - workout preview/start;
   - draft persistence, pause/resume, review-before-save;
   - dashboard and nutrition render;
   - Coach Sync screen opens;
   - no console errors.
8. Create an annotated semantic-version tag for the verified commit and add a concise changelog entry.

## Rollback

A code rollback must never mutate or delete stored workout, nutrition, photo, or coaching data.

1. Identify the last verified release tag/commit.
2. Revert the faulty change in a new `fix/*` branch. Prefer a forward fix; do not rewrite `main`.
3. Run `npm run ci` and the production smoke checklist.
4. Merge the rollback pull request and let Pages deploy it.
5. Verify that newer stored records remain readable.
6. Document the incident and corrective regression test.

If a database migration caused the incident, stop writes to the affected path, preserve a backup, and deploy a forward-compatible corrective migration. Never edit an already-applied migration or automatically restore an older database over newer user data.

## Manual redeploy

Use the GitHub Pages workflow’s manual dispatch only for the exact current verified `main` commit. A redeploy does not replace verification and must not be used to deploy an arbitrary unreviewed branch.
