# Changelog

All notable user-visible changes are recorded here. Versions follow semantic versioning.

## Unreleased

### App

- Line icons replace emoji and text symbols (tab bar, profile, set checks, add/restore, menu, chevrons); sync status moved from a floating pill to a quiet line under the header; Coach guidance shows plain labels such as "Daily steps" and "Zone 2 length".
- Restyled the app and the Coach connection screen with the Shift design tokens: one dark theme, cream text, red primary buttons, beak highlights, Big Shoulders Display for the wordmark, titles, exercise names and key numbers, flat cards and larger tap targets. Visual only.
- Progress overview: the last tile spans the full row instead of sitting alone.
- Removed nutrition from the app: four tabs (Today, Workout, Progress, Coach), no Fuel screen, food logging, presets, nutrition import or nutrition numbers. Existing nutrition records are kept unchanged on the phone and in the cloud.
- Renamed the app to Shift (title, header, sign-in, home-screen name and the Coach connection screen). Coach copy no longer mentions ChatGPT and says "plan" and "approve" instead of "proposal" and "update".

### Coach and sync

- Coach no longer receives nutrition: the coaching bridge drops nutrition records and the old protein/calorie day counts (takes effect when the edge function is redeployed). The connection screen now lists what Coach can see, can do and can't do.
- Fixed a startup error that stopped signed-in devices from refreshing from the cloud when the app opened.
- Coach plans: errors now show on the plan they belong to with the real cause, a plan the cloud already has is finished automatically, a plan stuck between approved and applied can always be retried or backed out of, and blocked plans show why instead of hiding the button.
- Fixed a device getting stuck on "Program changed elsewhere — refresh before editing": refreshing now replaces a program edit the cloud can never accept with the current cloud plan, and repeated offline program edits no longer skip revision numbers.
- Protected approved programs with revision checks so an older device cannot replace a newer Coach plan.
- Kept workout uploads independent of program conflicts, confirmed Coach updates in the cloud before marking them applied, and preserved the workout screen during background refresh.

### Workouts

- Rebuilt the active workout screen to the Shift comp: top bar with menu, timer and Pause, exercise progress, a large exercise header, the current set in a striped main card with a "Last time" line and Easy/Good/Hard/Failed asked before a red "Log set, start rest" button (which waits for an effort), completed and upcoming set rows, and an Up next card. Per-set logging, warm-ups, feel, undo, swipe actions and all workout controls work as before.
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
