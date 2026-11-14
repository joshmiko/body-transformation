# Changelog

All notable user-visible changes are recorded here. Versions follow semantic versioning.

## Unreleased

### App

- Renamed the app to Shift (title, header, sign-in, home-screen name and the Coach connection screen). Coach copy no longer mentions ChatGPT and says "plan" and "approve" instead of "proposal" and "update".

### Coach and sync

- Coach plans: errors now show on the plan they belong to with the real cause, a plan the cloud already has is finished automatically, a plan stuck between approved and applied can always be retried or backed out of, and blocked plans show why instead of hiding the button.
- Fixed a device getting stuck on "Program changed elsewhere — refresh before editing": refreshing now replaces a program edit the cloud can never accept with the current cloud plan, and repeated offline program edits no longer skip revision numbers.
- Protected approved programs with revision checks so an older device cannot replace a newer Coach plan.
- Kept workout uploads independent of program conflicts, confirmed Coach updates in the cloud before marking them applied, and preserved the workout screen during background refresh.

### Workouts

- Fixed workout durations that counted pauses and abandoned time: saved duration now subtracts pauses, resuming after more than 2 hours idle excludes the gap, and a duration over 4 hours falls back to set times and is marked estimated. Already-saved workouts keep their stored duration.
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
