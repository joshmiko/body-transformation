# Changelog

All notable user-visible changes are recorded here. Versions follow semantic versioning.

## Unreleased

### Workouts

- Preserved direct taps on set controls while retaining horizontal set-row swipe actions.
- Added a compact workout archive with per-workout sync status, retry, and JSON backup export. Reviewed workouts remain complete on this device when cloud sync is unavailable.

### Nutrition

- Replaced empty quick-add placeholders with six verified meal and snack presets from the Nutrition Plan.
- Added a safe, repeatable migration that upgrades untouched placeholders without overwriting customized presets.

### Foundation

- Added the protected branch and pull-request workflow documentation.
- Added release, rollback, migration, and GitHub settings runbooks.
- Added high-risk fitness-data and repository-pipeline regression checks.

## 0.1.0 — 2026-09-02

- Established the known-good mobile PWA baseline through commit `0716f86366c7e4d33a5d7d0b94fbde0d9fe30821`.
- Includes Coach Sync v2, Dashboard v1, Nutrition v1, and the refined mobile nutrition workflow.
