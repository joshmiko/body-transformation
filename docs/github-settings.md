# GitHub repository settings

Apply these settings to `main` after the foundation pull request passes.

## Branch protection / ruleset

- Require a pull request before merging.
- Require at least one approval when another reviewer is available.
- Dismiss stale approvals after new commits.
- Require the `Verify / verify` status check.
- Require branches to be up to date before merging.
- Require conversation resolution.
- Block force pushes and branch deletion.
- Do not allow bypass except for emergency repository administration.

For a single-maintainer period, GitHub may make required approvals impractical. Keep PRs and the required status check mandatory even if approval count is temporarily zero.

## Pages

- Source: GitHub Actions.
- Production environment: `github-pages`.
- Limit deployment to `main`.
- Keep environment history for rollback evidence.

## Secrets and security

- Store only deployment secrets in GitHub Actions secrets.
- `VITE_SUPABASE_URL` and the Supabase publishable/anon key may be delivered to the client.
- Never store a Supabase service-role key, database password, Apple private key, or AI API key in the repository or browser bundle.
- Enable secret scanning and Dependabot alerts when available.
