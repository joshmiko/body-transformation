// Renders the real workout screen (render() in index.html) with stubbed data and checks it
// against docs/design/comps/workout.html while keeping today's per-set logging controls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const line = name => html.match(new RegExp(`^function ${name}\\([^\\n]*$`, "m"))?.[0];
const renderSource = html.slice(html.indexOf("function render(d,ei){"), html.indexOf("\nfunction workouts(){"));
const iconSource = html.slice(html.indexOf("const UI_ICONS="), html.indexOf("const PROGRAM="));

const exercises = [
  { name: "Back Squat", sets: 3, min: 5, max: 8, rest: 150, cue: "Brace hard." },
  { name: "Barbell Bench Press", sets: 3, min: 5, max: 8, rest: 150, cue: "Shoulders back." },
  { name: "Lat Pulldown", sets: 3, min: 8, max: 12, rest: 90, cue: "Pull elbows down." },
  { name: "1-Arm DB Row", sets: 2, min: 8, max: 12, rest: 75, cue: "Flat back." },
  { name: "Single-Arm Cable Lateral Raise", sets: 2, min: 12, max: 20, rest: 60, cue: "Lead with the elbow." },
  { name: "DB Hammer Curl", sets: 2, min: 10, max: 15, rest: 60, cue: "Neutral grip." }
];

function renderScreen({ ei = 2, actual, warmups = [], paused = false, prev = [] }) {
  const app = { innerHTML: "" };
  const session = {
    id: "s1", performedDate: "2026-11-16", date: "2026-11-16", pausedAt: paused ? "2026-11-16T17:10:00Z" : null,
    exercises: { [String(ei)]: { name: exercises[ei].name, actual, warmups } }
  };
  const context = {
    db: { notes: {} }, workoutMenuOpen: false, warmupsExpanded: {},
    document: { body: { classList: { add() {} } }, getElementById: id => (id === "app" ? app : null) },
    getSession: () => session,
    sessionProgram: () => ({ exercises }),
    exerciseRecord: () => session.exercises[String(ei)],
    sets: () => actual,
    target: () => ({ w: 120, r: 8, why: "Keep the current load for this session." }),
    warmupRows: () => warmups,
    startWeight: () => 120,
    warmupCanBeAdded: () => false,
    warmupWasIntentionallyEmpty: () => false,
    previousActual: () => prev,
    startSessionClockTicker() {},
    formatDuration: () => "06:40",
    elapsedSeconds: () => 400,
    generalWarmupMarkup: () => '<section class="general-warmup">General warm-up</section>',
    restStatusMarkup: () => "",
    bindSwipeRows() {},
    marked: [],
    mark(d, i, j) { context.marked.push([d, i, j, actual[j].feel]); actual[j].done = true; actual[j].status = "completed"; }
  };
  vm.createContext(context);
  vm.runInContext([line("escapeHtml"), line("normalizeFeel"), iconSource, line("swipeRowShell"), renderSource].join("\n"), context);
  context.render("Monday", ei);
  return { markup: app.innerHTML, context };
}

const done = (weight, reps, feel) => ({ done: true, status: "completed", weight, reps, feel });
const planned = () => ({ done: false, status: "planned" });
const count = (markup, needle) => markup.split(needle).length - 1;

test("middle set: comp layout around per-set logging", () => {
  const prev = [{ date: "2026-11-09", w: 120, r: 10, feel: "Good" }, { date: "2026-11-16", w: 125, r: 9, feel: "Hard" }];
  const { markup } = renderScreen({ actual: [done(120, 10, "Good"), planned(), planned()], prev });

  // Top bar, progress segments and exercise header
  assert.match(markup, /<button class="ws-round" type="button" aria-label="Workout menu" aria-expanded="false" onclick="toggleWorkoutMenu\('Monday',2\)">/);
  assert.match(markup, /<div class="ws-day">Monday shift<\/div><time id="bt-session-clock" class="session-duration" aria-label="Workout duration">06:40<\/time>/);
  assert.match(markup, /<button class="ws-pill" type="button" aria-pressed="false" onclick="togglePause\('Monday',2\)">Pause<\/button>/);
  assert.match(markup, /class="ws-segments" role="img" aria-label="Exercise 3 of 6"/);
  assert.equal(count(markup, '<span class="ws-seg'), 6);
  assert.equal(count(markup, "ws-seg-filled"), 1);
  assert.match(markup, /<div class="ws-count">Exercise 3 of 6<\/div><div class="ename ws-name">Lat Pulldown<\/div>/);
  assert.match(markup, /<p class="ws-plan">3 sets of 8 to 12, rest 1:30\. <span class="form-cue-callout">Pull elbows down\.<\/span><\/p>/);

  // Main card: stripe band once, on the current set, with the "Last time" line from a previous workout
  assert.equal(count(markup, 'class="stripe-band"'), 1);
  const card = markup.slice(markup.indexOf('<section class="ws-current"'), markup.indexOf("</section>", markup.indexOf('<section class="ws-current"')));
  assert.match(card, /^<section class="ws-current" aria-label="Current set"><div class="stripe-band" aria-hidden="true">/);
  assert.match(card, /<h2 class="ws-set-title">Set 2<\/h2><div class="ws-last">Last time, Nov 9: 120 × 10, Good<\/div>/);
  assert.match(card, /<label>Weight, lb<input  value="120" inputmode="decimal" onchange="edit\('Monday',2,1,'weight',this\.value\)"><\/label>/);
  assert.match(card, /<label>Reps<input  value="8" inputmode="numeric" onchange="edit\('Monday',2,1,'reps',this\.value\)"><\/label>/);
  // Effort is asked in the card before logging; Log set waits for it.
  for (const feel of ["Easy", "Good", "Hard", "Failed"]) assert.match(card, new RegExp(`aria-pressed="false"  onclick="chooseWorkoutEffort\\('Monday',2,1,'${feel}'\\)">${feel}</button>`));
  assert.match(card, /<div class="ws-effort" role="group" aria-label="How did it feel">/);
  assert.match(card, /<button class="primary ws-log" type="button" disabled aria-describedby="ws-effort-hint" onclick="logWorkoutSet\('Monday',2,1\)">Log set, start 1:30 rest<\/button><p id="ws-effort-hint" class="ws-hint">Pick how it felt to log this set\.<\/p>/);
  assert.ok(card.indexOf("ws-inputs") < card.indexOf("ws-effort") && card.indexOf("ws-effort") < card.indexOf("ws-log"), "inputs, then effort, then Log set");
  assert.match(card, /onclick="rowAction\('Monday',2,1,'working'\)">Skip set<\/button>/);
  assert.equal(count(markup, 'class="primary'), 1, "one red primary button");

  // Completed row above the card keeps inputs, check, swipe, feel and undo
  const completed = markup.slice(markup.indexOf('aria-label="Completed sets"'), markup.indexOf('<section class="ws-current"'));
  assert.match(completed, /data-swipe-row/);
  assert.match(completed, /onclick="mark\('Monday',2,0\)"/);
  assert.match(completed, /rowAction\('Monday',2,0,'working'\)/);
  for (const feel of ["Easy", "Good", "Hard", "Failed"]) assert.match(completed, new RegExp(`onclick="feel\\('Monday',2,0,'${feel}'\\)">${feel}</button>`));
  assert.match(completed, /class="sel" aria-pressed="true" onclick="feel\('Monday',2,0,'Good'\)"/);
  assert.match(completed, /data-set="0" onclick="undoSetFromButton\(this\)">Undo<\/button>/);

  // Upcoming row below the card can still be edited and logged out of order
  const upcoming = markup.slice(markup.indexOf('aria-label="Upcoming sets"'));
  assert.match(upcoming, /<span class="ws-row-label">Set 3<\/span><input aria-label="Set 3 weight"  value="120"/);
  assert.match(upcoming, /onclick="mark\('Monday',2,2\)"/);
  assert.match(upcoming, /rowAction\('Monday',2,2,'working'\)/);

  // Tools, up next and step buttons
  assert.match(markup, /onclick="addSet\('Monday',2,'working'\)">.*Add set<\/button>/);
  assert.match(markup, /<div class="ws-upnext-label">Up next<\/div><div class="ws-upnext-name">1-Arm DB Row<\/div><\/div><div class="ws-upnext-plan">2 sets of 8 to 12<\/div>/);
  assert.match(markup, /onclick="render\('Monday',1\)">Previous<\/button><button class="secondary" type="button" onclick="rest\(90\)">Rest<\/button><button class="secondary" type="button" onclick="render\('Monday',3\)">Next<\/button>/);
  for (const marker of ["workout-header", "session-duration", "form-cue-callout", "data-swipe-row"]) assert.ok(markup.includes(marker), marker);
});

test("paused: logging is disabled and Pause reads Resume", () => {
  const { markup } = renderScreen({ actual: [planned(), planned(), planned()], paused: true });
  assert.match(markup, /aria-pressed="true" onclick="togglePause\('Monday',2\)">Resume<\/button>/);
  assert.match(markup, /<span class="paused-state" aria-live="polite">Paused<\/span>/);
  assert.match(markup, /<button class="primary ws-log" type="button" disabled aria-describedby="ws-effort-hint" onclick="logWorkoutSet\('Monday',2,0\)">/);
  assert.match(markup, /aria-pressed="false" disabled onclick="chooseWorkoutEffort\('Monday',2,0,'Easy'\)"/);
  assert.match(markup, /<label>Weight, lb<input disabled value="120"/);
});

test("last exercise with every set logged: Finish workout, no stripe band", () => {
  const { markup } = renderScreen({ ei: 5, actual: [done(30, 10, "Good"), done(30, 10, "Hard")] });
  assert.equal(count(markup, 'class="stripe-band"'), 0);
  assert.match(markup, /<h2 class="ws-set-title">Sets logged<\/h2><div class="ws-last">2 of 2 sets<\/div><\/div><button class="primary ws-log" type="button" onclick="finish\('Monday'\)">Finish workout<\/button>/);
  assert.match(markup, /<div class="ws-upnext-name">Review and save<\/div><\/div><div class="ws-upnext-plan">Last exercise<\/div>/);
  assert.match(markup, /onclick="finish\('Monday'\)">Finish<\/button><\/div><\/div>$/);
  assert.match(markup, /aria-label="Exercise 6 of 6"/);
  assert.equal(count(markup, 'class="primary'), 1);
});

test("warm-ups keep their rows, swipe actions and add button; general warm-up stays on exercise 1", () => {
  const warmups = [{ weight: 45, reps: 9, done: true, status: "completed" }, { weight: 135, reps: 5, status: "planned" }];
  const { markup } = renderScreen({ ei: 0, actual: [planned(), planned(), planned()], warmups });
  assert.ok(markup.indexOf("general-warmup") < markup.indexOf('aria-label="Warm-up sets"'));
  assert.match(markup, /<span class="ws-section-title">Warm-up sets<\/span><span class="ws-section-note">Not counted toward progression<\/span>/);
  assert.match(markup, /aria-label="Warm-up 1 weight" value="45" inputmode="decimal"  onchange="wuEdit\('Monday',0,0,'w',this\.value\)"/);
  assert.match(markup, /aria-label="Warm-up 1 done" onclick="wuDone\('Monday',0,0\)"/);
  assert.match(markup, /aria-label="Mark warm-up 2 done" onclick="wuDone\('Monday',0,1\)"/);
  assert.match(markup, /rowAction\('Monday',0,1,'warmup'\)/);
  assert.match(markup, /onclick="addWarmup\('Monday',0\)">.*Add warm-up set<\/button>/);
  assert.ok(markup.indexOf('aria-label="Warm-up sets"') < markup.indexOf('<section class="ws-current"'), "warm-ups come before the current set");
  assert.match(markup, /disabled>Previous<\/button>/);
});

test("plan and last-time helpers format like the comp", () => {
  const { context } = renderScreen({ actual: [planned()] });
  assert.equal(context.workoutRestLabel(120), "2:00");
  assert.equal(context.workoutRestLabel(75), "1:15");
  assert.equal(context.workoutPlanLine({ sets: 3, min: 8, max: 12, rest: 120 }), "3 sets of 8 to 12, rest 2:00.");
  assert.equal(context.workoutRepRange({ min: 20, max: 45, unit: "sec" }), "20 to 45 sec");
  assert.equal(context.workoutLastTime({ date: "2026-10-17", w: 517, r: 12, feel: "Good" }, false), "Last time, Oct 17: 517 × 12, Good");
  assert.equal(context.workoutLastTime({ date: "2026-10-17", seconds: 30, feel: "" }, true), "Last time, Oct 17: 30 sec");
});

test("effort is required before a set is logged, and is saved with the set", () => {
  const actual = [planned(), planned(), planned()];
  const { context } = renderScreen({ actual });
  const app = () => context.document.getElementById("app").innerHTML;
  context.logWorkoutSet("Monday", 2, 0);
  assert.deepEqual(context.marked, [], "no effort picked: nothing is logged and no rest starts");

  context.chooseWorkoutEffort("Monday", 2, 0, "Hard");
  assert.match(app(), /class="sel" aria-pressed="true"  onclick="chooseWorkoutEffort\('Monday',2,0,'Hard'\)">Hard<\/button>/);
  assert.match(app(), /<button class="primary ws-log" type="button"   onclick="logWorkoutSet\('Monday',2,0\)">Log set, start 1:30 rest<\/button>/);
  assert.doesNotMatch(app(), /ws-effort-hint/);
  assert.equal(actual[0].feel, undefined, "the choice is not written to the set until it is logged");

  context.logWorkoutSet("Monday", 2, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(context.marked)), [["Monday", 2, 0, "Hard"]], "logged once, with the effort already on the set");
  context.logWorkoutSet("Monday", 2, 0);
  assert.equal(context.marked.length, 1, "a logged set is not logged again");

  context.chooseWorkoutEffort("Monday", 2, 1, "Tired");
  context.render("Monday", 2);
  assert.match(app(), /<h2 class="ws-set-title">Set 2<\/h2>/);
  assert.match(app(), /disabled aria-describedby="ws-effort-hint" onclick="logWorkoutSet\('Monday',2,1\)"/, "unknown efforts are ignored");
});
