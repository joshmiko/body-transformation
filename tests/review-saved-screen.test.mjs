// Renders the real review (docs/design/comps/review.html) and saved (docs/design/comps/saved.html)
// screens from index.html with stubbed data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const line = name => {
  const found = html.match(new RegExp(`^function ${name}\\([^\\n]*$`, "m"))?.[0];
  assert.ok(found, name);
  return found;
};
const screens = html.slice(html.indexOf("// Review before save:"), html.indexOf("\nfunction saveReviewedWorkout(d){"));

const exercises = [
  { name: "Back Squat", sets: 3, min: 5, max: 8 },
  { name: "Dead Hang", sets: 2, min: 20, max: 45, unit: "sec" }
];
const done = (weight, reps, feel) => ({ done: true, status: "completed", weight, reps, feel });

function load({ syncState = "pending", localError = null } = {}) {
  const elements = {};
  const app = { innerHTML: "" };
  const session = {
    id: "s1", programDay: "Monday", performedDate: "2026-11-16", status: "review",
    startedAt: "2026-11-16T17:08:00.000Z", endedAt: "2026-11-16T18:19:00.000Z", durationSec: 4260, pausedTotalSec: 0,
    overallFeel: null, sessionNote: "", stats: { completedSets: 4, workingSets: 5 },
    exercises: {
      0: { actual: [done(205, 5, "Good"), done(205, 5, "Good"), done(205, 4, "Hard"), { status: "skipped", done: false }], warmups: [{ weight: 45, reps: 9, done: true }, { weight: 135, reps: 5, status: "skipped" }] },
      1: { actual: [{ done: true, status: "completed", seconds: 30, feel: "Good" }, { done: false, status: "planned" }], warmups: [] }
    },
    programSnapshot: { title: "Monday — Squat + Bench", exercises }
  };
  const calls = { edits: [], saves: 0, home: 0, resume: 0, saveReviewed: 0 };
  const context = {
    session, calls, elements, btLocalWriteError: localError,
    PROGRAM: { Monday: { title: "Monday — Squat + Bench", exercises } },
    window: { btSupabase: { workoutSyncStatus: () => ({ state: syncState, label: syncState }) } },
    document: {
      body: { classList: { remove() {}, add() {} } },
      getElementById: id => (id === "app" ? app : elements[id] || null),
      querySelectorAll: () => []
    },
    getSession: () => session,
    sessionDurationSec: s => s.durationSec,
    elapsedSeconds: () => 0,
    reviewSetEdit: (...args) => calls.edits.push(args),
    save: () => { calls.saves++; },
    home: () => { calls.home++; },
    resumeDraft: () => { calls.resume++; },
    saveReviewedWorkout: () => { calls.saveReviewed++; },
    today: () => "2026-11-16",
    localDateKey: d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"),
    planForDay: day => (day === "Wednesday" ? { title: "Wednesday — Pull + Hinge", exercises: [{}, {}, {}, {}] } : { exercises: [] }),
    activityPlanForDay: day => (day === "Tuesday" ? { title: "Tuesday — Zone 2 Bike", type: "zone2", durationMin: 30, durationMax: 40 } : { title: day + " — Recovery", type: "recovery" })
  };
  vm.createContext(context);
  vm.runInContext([
    line("escapeHtml"), line("validTimestamp"), line("localTimeLabel"), line("completedSetTimes"),
    line("derivedDurationSec"), line("applyFinishedDuration"),
    screens
  ].join("\n"), context);
  return { context, session, app, calls, elements };
}

// workoutSyncLabel spans three lines in index.html; load it whole.
const syncLabelSource = html.slice(html.indexOf("function workoutSyncLabel(s){"), html.indexOf("\nfunction workoutRecoveryMarkup("));

test("review screen follows the comp and keeps the save hooks", () => {
  const { context, app } = loadWithSync();
  context.reviewWorkout("Monday");
  const m = app.innerHTML;
  assert.match(m, /<div class="rv-date">Mon Nov 16, Squat \+ Bench<\/div><h2 class="rv-title">Review your shift<\/h2><p class="rv-sub">Tap any set to fix it\. Nothing is final until you save\.<\/p>/);
  assert.match(m, /<div id="review-duration" class="review-duration rv-time-value">71:00<\/div>/);
  assert.match(m, /onclick="toggleReviewTime\('Monday'\)">Fix time<\/button>/);
  // Chips: one per working set, with the comp's wording
  assert.equal(m.split('<button type="button" class="rv-chip').length - 1, 6);
  assert.match(m, /aria-label="Set 1: 205 pounds for 5, Good\. Edit set\." aria-expanded="false" onclick="toggleReviewSet\('Monday',0,0\)"><span class="rv-chip-value">205 × 5<\/span><span class="rv-chip-sub">Good<\/span>/);
  assert.match(m, /class="rv-chip rv-chip-flag" aria-label="Set 3: 205 pounds for 4, Hard\. Edit set\."/);
  assert.match(m, /class="rv-chip rv-chip-skipped" aria-label="Set 4: skipped\. Edit set\."[^>]*><span class="rv-chip-value">Skipped<\/span><span class="rv-chip-sub">Not counted<\/span>/);
  assert.match(m, /<span class="rv-chip-value">30 sec<\/span><span class="rv-chip-sub">Good<\/span>/);
  assert.match(m, /<span class="rv-chip-value">—<\/span><span class="rv-chip-sub">Not logged<\/span>/);
  assert.match(m, /aria-expanded="false" onclick="[^"]*rv-warm-list[^"]*">1 warm-up<\/button>/, "count excludes skipped warm-ups");
  // Ids and hooks the save path depends on
  assert.match(m, /<input type="hidden" id="review-overall-feel" value="">/);
  assert.match(m, /<textarea id="session-note" class="review-session-note" rows="3" placeholder="Anything worth remembering\?">/);
  assert.match(m, /<label class="rv-note-label" for="session-note">Note for Coach, optional<\/label>/);
  assert.match(m, /<button class="primary" id="review-save-workout" type="button">Save workout<\/button><button class="secondary" id="review-keep-editing" type="button">Back to workout<\/button>/);
  assert.equal(m.split('class="primary').length - 1, 1);
  for (const feel of ["Easy", "Normal", "Hard"]) assert.match(m, new RegExp(`data-overall-feel="${feel}" aria-pressed="false" onclick="setReviewOverallFeel\\('Monday','${feel}'\\)">${feel}</button>`));
  assert.match(m, /data-review-note="0"[^>]*hidden><\/textarea>/, "exercise note stays reachable");
});

test("tapping a chip opens an editor that edits the set as before", () => {
  const { context, app } = loadWithSync();
  context.toggleReviewSet("Monday", 0, 2);
  const m = app.innerHTML;
  assert.match(m, /aria-label="Set 3: 205 pounds for 4, Hard\. Edit set\." aria-expanded="true"/);
  assert.match(m, /<input class="review-weight" aria-label="Back Squat set 3 weight" value="205" inputmode="decimal" onchange="reviewSetEdit\('Monday',0,2,'weight',this\.value\)">/);
  assert.match(m, /<input class="review-reps" aria-label="Back Squat set 3 reps" value="4" inputmode="numeric" onchange="reviewSetEdit\('Monday',0,2,'reps',this\.value\)">/);
  assert.match(m, /class="sel" aria-pressed="true" onclick="reviewSetEdit\('Monday',0,2,'feel','Hard'\);reviewWorkout\('Monday'\)">Hard<\/button>/);
  context.toggleReviewSet("Monday", 1, 0);
  assert.match(app.innerHTML, /aria-label="Dead Hang set 1 seconds" value="30" inputmode="numeric" onchange="reviewSetEdit\('Monday',1,0,'seconds',this\.value\)"/);
  assert.doesNotMatch(app.innerHTML, /Dead Hang set 1 weight/, "timed sets have no weight field");
  context.toggleReviewSet("Monday", 1, 0);
  assert.doesNotMatch(app.innerHTML, /class="rv-editor"/);
});

test("Fix time saves start and end to this session only and recomputes duration", () => {
  const { context, session, elements, calls, app } = loadWithSync();
  context.toggleReviewTime("Monday");
  assert.match(app.innerHTML, /<input type="time" id="review-start" value="\d\d:\d\d">/);
  const start = new Date(session.startedAt);
  elements["review-start"] = { value: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}` };
  const end = new Date(new Date(session.startedAt).getTime() + 83 * 60000);
  elements["review-end"] = { value: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}` };
  elements["review-time-error"] = { textContent: "" };
  context.saveReviewTime("Monday");
  assert.equal(session.durationSec, 83 * 60);
  assert.equal(Date.parse(session.endedAt) - Date.parse(session.startedAt), 83 * 60000);
  assert.equal(calls.saves, 1);
  assert.match(app.innerHTML, /review-duration rv-time-value">83:00</);

  elements["review-start"] = { value: "06:00" };
  elements["review-end"] = { value: "20:00" };
  const before = session.endedAt;
  context.saveReviewTime("Monday");
  assert.equal(elements["review-time-error"].textContent, "That is more than 12 hours. Check the times.");
  assert.equal(session.endedAt, before, "refused times change nothing");
  elements["review-start"] = { value: "" };
  context.saveReviewTime("Monday");
  assert.equal(elements["review-time-error"].textContent, "Enter a start and an end time.");
  assert.equal(calls.saves, 1);
});

test("saved screen only claims the cloud after a confirmed write", () => {
  const card = state => { const { context, session } = loadWithSync({ syncState: state }); return context.savedCloudMarkup(session); };
  assert.match(card("synced"), /<div class="sv-cloud-title">Saved to the cloud<\/div><div class="sv-cloud-detail">Coach can see this workout now\.<\/div>/);
  assert.doesNotMatch(card("synced"), /Retry sync/);
  for (const state of ["pending", "sign-in-needed"]) {
    assert.doesNotMatch(card(state), /Saved to the cloud|Coach can see/, state);
    assert.match(card(state), /<div class="sv-cloud-title">Saved on this phone<\/div>/, state);
    assert.match(card(state), /data-workout-retry="s1" onclick="retryWorkoutSync\(true\)">Retry sync<\/button>/);
    assert.match(card(state), /data-workout-export="s1"/);
  }
  assert.match(card("pending"), /It will sync to the cloud when you're online\./);
  assert.match(card("sign-in-needed"), /Sign in to sync it to the cloud\./);
  const { context, session } = loadWithSync({ localError: new Error("quota") });
  assert.match(context.savedCloudMarkup(session), /Phone storage needs attention/);
  assert.match(html, /document\.querySelectorAll\("\[data-saved-cloud\]"\)\.forEach\(el=>\{const s=workoutRecordById\(el\.dataset\.savedCloud\);if\(s&&el\.dataset\.syncState!==workoutSyncLabel\(s\)\.state\)el\.outerHTML=savedCloudMarkup\(s\)\}\)/, "the card refreshes when a sync confirms");
});

test("saved screen follows the comp", () => {
  const { context, session, app } = loadWithSync();
  session.overallFeel = "Normal";
  context.renderSavedWorkout("Monday");
  const m = app.innerHTML;
  assert.match(m, /^<div class="sv-page"><div class="sv-stripes" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/div><div class="sv-head"><h2 class="sv-title">Shift<br>over<\/h2><div class="sv-date">Mon Nov 16, Squat \+ Bench<\/div>/);
  assert.match(m, /<div class="sv-stat-value">4<span class="sv-stat-of">\/5<\/span><\/div><div class="sv-stat-label">working sets<\/div>/);
  assert.match(m, /<div class="sv-stat-value">71:00<\/div><div class="sv-stat-label">on the clock<\/div>/);
  assert.match(m, /<div class="sv-stat-value sv-stat-feel">Normal<\/div><div class="sv-stat-label">overall feel<\/div>/);
  assert.match(m, /<div class="sv-next-label">Up next<\/div><div class="sv-next-title">Zone 2 Bike<\/div><div class="sv-next-detail">Tuesday, 30 to 40 minutes<\/div><\/div><div class="sv-next-day" aria-hidden="true">17<\/div>/);
  assert.match(m, /<button class="primary" type="button" onclick="home\(\)">Done<\/button><button class="rv-text-button sv-details" type="button" onclick="reviewWorkout\('Monday'\)">View workout details<\/button>/);
  assert.equal(m.split('class="primary').length - 1, 1);
});

function loadWithSync(options) {
  const loaded = load(options);
  vm.runInContext(syncLabelSource, loaded.context);
  return loaded;
}
