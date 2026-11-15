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

function renderScreen({ ei = 2, actual, warmups = [], paused = false, prev = [], sessions = {} }) {
  const app = { innerHTML: "" };
  const session = {
    id: "s1", performedDate: "2026-11-16", date: "2026-11-16", pausedAt: paused ? "2026-11-16T17:10:00Z" : null,
    exercises: { [String(ei)]: { name: exercises[ei].name, actual, warmups } }
  };
  const context = {
    db: { notes: {}, sessions }, workoutMenuOpen: false, warmupsExpanded: {}, workoutRowEdit: null,
    document: { body: { classList: { add() {}, remove() {} } }, getElementById: id => (id === "app" ? app : null) },
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

test("middle set: comp layout with compact rows, preselected feel, one-tap Log", () => {
  const { markup } = renderScreen({ actual: [done(120, 10, "Good"), planned(), planned()], prev: [{ date: "2026-11-09", w: 120, r: 10, feel: "Good" }] });

  // Top bar, progress segments and exercise header
  assert.match(markup, /<button class="ws-round" type="button" aria-label="Workout menu" aria-expanded="false" onclick="toggleWorkoutMenu\('Monday',2\)">/);
  assert.match(markup, /<div class="ws-day">Monday shift<\/div><time id="bt-session-clock" class="session-duration" aria-label="Workout duration">06:40<\/time>/);
  assert.match(markup, /<button class="ws-pill" type="button" aria-pressed="false" onclick="togglePause\('Monday',2\)">Pause<\/button>/);
  assert.match(markup, /class="ws-segments" role="img" aria-label="Exercise 3 of 6"/);
  assert.equal(count(markup, '<span class="ws-seg'), 6);
  assert.equal(count(markup, "ws-seg-filled"), 1);
  assert.match(markup, /<div class="ws-count">Exercise 3 of 6<\/div><div class="ename ws-name">Lat Pulldown<\/div>/);
  assert.match(markup, /<p class="ws-plan">3 sets of 8 to 12, rest 1:30\. <span class="form-cue-callout">Pull elbows down\.<\/span><\/p>/);

  // Main card: stripe band once, Last time line, and no "Reference load" Coach note
  assert.equal(count(markup, 'class="stripe-band"'), 1);
  const card = markup.slice(markup.indexOf('<section class="ws-current"'), markup.indexOf("</section>", markup.indexOf('<section class="ws-current"')));
  assert.match(card, /<h2 class="ws-set-title">Set 2<\/h2><div class="ws-last">Last time, Nov 9: 120 × 10, Good<\/div>/);
  assert.doesNotMatch(card, /ws-why|Reference load/);
  assert.match(card, /<label>Weight, lb<input  value="120" inputmode="decimal" onchange="edit\('Monday',2,1,'weight',this\.value\)"><\/label>/);
  assert.match(card, /<label>Reps<input  value="8" inputmode="numeric" onchange="edit\('Monday',2,1,'reps',this\.value\)"><\/label>/);
  // Feel is preselected (Good, no history) and Log is red, enabled, logs in one tap
  for (const feel of ["Easy", "Good", "Hard", "Failed"]) assert.match(card, new RegExp(`onclick="chooseWorkoutEffort\\('Monday',2,1,'${feel}'\\)">${feel}</button>`));
  assert.match(card, /class="sel" aria-pressed="true"  onclick="chooseWorkoutEffort\('Monday',2,1,'Good'\)">Good<\/button>/);
  assert.match(card, /<button class="primary ws-log" type="button"  onclick="logWorkoutSetWithEffort\('Monday',2,1,'Good'\)">Log set, start 1:30 rest<\/button>/);
  assert.doesNotMatch(card, /disabled|ws-effort-hint/);
  assert.match(card, /onclick="rowAction\('Monday',2,1,'working'\)">Skip set<\/button>/);
  assert.equal(count(markup, 'class="primary'), 1, "one red primary button");

  // Completed row above the card is compact, with a cream check, and opens an editor on tap
  const completed = markup.slice(markup.indexOf('aria-label="Completed sets"'), markup.indexOf('<section class="ws-current"'));
  assert.match(completed, /data-swipe-row/);
  assert.match(completed, /<button type="button" class="ws-crow-main" aria-expanded="false" aria-label="Set 1: 120 by 10, Good\. Edit set\." onclick="toggleWorkoutRow\('Monday',2,0,'working'\)"><span class="ws-crow-label">Set 1<\/span><span class="ws-crow-value">120 × 10<\/span><span class="ws-crow-feel">Good<\/span><\/button>/);
  assert.match(completed, /<span class="check done" aria-hidden="true">/);
  assert.match(completed, /rowAction\('Monday',2,0,'working'\)/);
  assert.doesNotMatch(completed, /aria-label="Set 1 weight"/, "no visible inputs until opened");

  // Upcoming row below the card is plain, with the rep range and target weight
  const upcoming = markup.slice(markup.indexOf('aria-label="Upcoming sets"'));
  assert.match(upcoming, /<button type="button" class="ws-crow ws-crow-up" aria-expanded="false" aria-label="Set 3, 8 to 12 reps\. Open to log\." onclick="toggleWorkoutRow\('Monday',2,2,'working'\)"><span class="ws-crow-label">Set 3<\/span><span class="ws-crow-sub">8 to 12 reps<\/span><span class="ws-crow-target">120 lb<\/span><\/button>/);
  assert.doesNotMatch(upcoming, /aria-label="Set 3 weight"/);
  assert.match(upcoming, /rowAction\('Monday',2,2,'working'\)/);

  // Tools, up next and step buttons
  assert.match(markup, /onclick="addSet\('Monday',2,'working'\)">.*Add set<\/button>/);
  assert.match(markup, /<div class="ws-upnext-label">Up next<\/div><div class="ws-upnext-name">1-Arm DB Row<\/div><\/div><div class="ws-upnext-plan">2 sets of 8 to 12<\/div>/);
  assert.match(markup, /onclick="render\('Monday',1\)">Previous<\/button><button class="secondary" type="button" onclick="rest\(90\)">Rest<\/button><button class="secondary" type="button" onclick="render\('Monday',3\)">Next<\/button>/);
  for (const marker of ["workout-header", "session-duration", "form-cue-callout", "data-swipe-row"]) assert.ok(markup.includes(marker), marker);
});

test("paused: logging and inputs are disabled, Pause reads Resume", () => {
  const { markup } = renderScreen({ actual: [planned(), planned(), planned()], paused: true });
  assert.match(markup, /aria-pressed="true" onclick="togglePause\('Monday',2\)">Resume<\/button>/);
  assert.match(markup, /<span class="paused-state" aria-live="polite">Paused<\/span>/);
  assert.match(markup, /<button class="primary ws-log" type="button" disabled onclick="logWorkoutSetWithEffort\('Monday',2,0,'Good'\)">/);
  assert.doesNotMatch(markup, /ws-effort-hint/);
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

test("warm-ups are compact rows that collapse when done; general warm-up stays on exercise 1", () => {
  const warmups = [{ weight: 45, reps: 9, done: true, status: "completed" }, { weight: 135, reps: 5, status: "planned" }];
  const { markup } = renderScreen({ ei: 0, actual: [planned(), planned(), planned()], warmups });
  assert.ok(markup.indexOf("general-warmup") < markup.indexOf('aria-label="Warm-up sets"'));
  assert.ok(markup.indexOf('aria-label="Warm-up sets"') < markup.indexOf('<section class="ws-current"'), "warm-ups come before the current set");
  assert.match(markup, /<span class="ws-section-title">Warm-up sets<\/span><span class="ws-section-note">Not counted toward progression<\/span>/);
  // Compact rows: W1 label + "45 × 9" value + check button; no always-visible inputs
  assert.match(markup, /<button type="button" class="ws-crow-main" aria-expanded="false" aria-label="Warm-up 1: 45 × 9\. Edit warm-up\." onclick="toggleWorkoutRow\('Monday',0,0,'warmup'\)"><span class="ws-crow-label">W1<\/span><span class="ws-crow-value">45 × 9<\/span><\/button>/);
  assert.match(markup, /aria-label="Warm-up 1 done" onclick="wuDone\('Monday',0,0\)"/);
  assert.match(markup, /aria-label="Mark warm-up 2 done" onclick="wuDone\('Monday',0,1\)"/);
  assert.match(markup, /<span class="ws-crow-value">135 × 5<\/span>/);
  assert.doesNotMatch(markup, /aria-label="Warm-up 1 weight"/, "no warm-up inputs until a row is opened");
  assert.match(markup, /rowAction\('Monday',0,1,'warmup'\)/);
  assert.match(markup, /onclick="addWarmup\('Monday',0\)">.*Add warm-up set<\/button>/);
  assert.match(markup, /disabled>Previous<\/button>/);

  // All done/skipped -> collapsed one-liner, reopenable
  const allDone = renderScreen({ ei: 0, actual: [planned(), planned(), planned()], warmups: [{ weight: 45, reps: 9, done: true, status: "completed" }, { weight: 135, reps: 5, status: "skipped" }] }).markup;
  assert.match(allDone, /<button type="button" class="ws-warm-collapsed" aria-expanded="false" onclick="toggleWarmups\('Monday',0\)"><span>Warm-ups done · 2 of 2<\/span><span class="ws-collapse-cue">Show<\/span><\/button>/);
  assert.doesNotMatch(allDone, /ws-section-title/);
});

test("tapping a warm-up row opens an inline weight/reps editor", () => {
  const warmups = [{ weight: 45, reps: 9, status: "planned" }];
  const { context } = renderScreen({ ei: 0, actual: [planned(), planned(), planned()], warmups, warmupRows: warmups });
  const app = () => context.document.getElementById("app").innerHTML;
  assert.doesNotMatch(app(), /aria-label="Warm-up 1 weight"/);
  context.toggleWorkoutRow("Monday", 0, 0, "warmup");
  const a = app();
  assert.match(a, /aria-label="Warm-up 1 weight" value="45" inputmode="decimal"  onchange="wuEdit\('Monday',0,0,'w',this\.value\)"/);
  assert.match(a, /aria-label="Warm-up 1 reps" value="9" inputmode="numeric"  onchange="wuEdit\('Monday',0,0,'r',this\.value\)"/);
  assert.match(a, /onclick="toggleWorkoutRow\('Monday',0,0,'warmup'\)">Done<\/button>/);
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

test("feel is preselected from history, and a set logs in one tap with that feel", () => {
  const actual = [planned(), planned(), planned()];
  const sessions = { s1: { status: "saved", performedDate: "2026-11-01", exercises: { a: { name: "Lat Pulldown", actual: [done(100, 10, "Hard"), done(100, 10, "Failed")] } } } };
  const { context } = renderScreen({ actual, sessions });
  const app = () => context.document.getElementById("app").innerHTML;
  assert.equal(context.defaultWorkoutFeel("Lat Pulldown", 0), "Hard");
  assert.equal(context.defaultWorkoutFeel("Lat Pulldown", 1), "Failed");
  assert.equal(context.defaultWorkoutFeel("Lat Pulldown", 2), "Good", "no history for set 3 -> Good");
  // card for set 1 preselects Hard and the Log button carries it
  assert.match(app(), /class="sel" aria-pressed="true"  onclick="chooseWorkoutEffort\('Monday',2,0,'Hard'\)">Hard<\/button>/);
  assert.match(app(), /<button class="primary ws-log" type="button"  onclick="logWorkoutSetWithEffort\('Monday',2,0,'Hard'\)">/);
  // change feel then log -> logs once with the chosen feel
  context.chooseWorkoutEffort("Monday", 2, 0, "Easy");
  context.logWorkoutSetWithEffort("Monday", 2, 0, "Easy");
  assert.deepEqual(JSON.parse(JSON.stringify(context.marked)), [["Monday", 2, 0, "Easy"]]);
  assert.equal(actual[0].feel, "Easy");
  // logging the next set without tapping uses its preselected default (Failed)
  context.logWorkoutSet("Monday", 2, 1);
  assert.equal(actual[1].feel, "Failed");
  assert.equal(context.marked.length, 2);
});

test("tapping a set row opens an inline editor; upcoming logs, completed changes feel and unlogs", () => {
  const actual = [done(120, 10, "Good"), planned(), planned()];
  const { context } = renderScreen({ actual });
  const app = () => context.document.getElementById("app").innerHTML;

  // Completed row: tap opens an editor with feel() and Unlog set
  assert.doesNotMatch(app(), /aria-label="Set 1 weight"/);
  context.toggleWorkoutRow("Monday", 2, 0, "working");
  let a = app();
  assert.match(a, /aria-label="Set 1 weight" value="120" inputmode="decimal"  onchange="edit\('Monday',2,0,'weight',this\.value\)"/);
  assert.match(a, /class="sel" aria-pressed="true"  onclick="feel\('Monday',2,0,'Good'\)">Good<\/button>/);
  assert.match(a, /onclick="mark\('Monday',2,0\)">Unlog set<\/button>/);
  assert.match(a, /onclick="toggleWorkoutRow\('Monday',2,0,'working'\)">Done<\/button>/);
  context.toggleWorkoutRow("Monday", 2, 0, "working");
  assert.doesNotMatch(app(), /Unlog set/);

  // Upcoming row: tap opens an editor with preselected feel and a red Log
  context.toggleWorkoutRow("Monday", 2, 2, "working");
  a = app();
  assert.match(a, /aria-label="Set 3 weight" value="120" inputmode="decimal"  onchange="edit\('Monday',2,2,'weight',this\.value\)"/);
  assert.match(a, /onclick="chooseWorkoutEffort\('Monday',2,2,'Good'\)">Good<\/button>/);
  assert.match(a, /<button class="primary ws-log" type="button"  onclick="logWorkoutSetWithEffort\('Monday',2,2,'Good'\)">Log set, start 1:30 rest<\/button>/);
  assert.match(a, /onclick="toggleWorkoutRow\('Monday',2,2,'working'\)">Cancel<\/button>/);

  // Skipped row shows no editor
  actual[1] = { status: "skipped", done: false };
  context.render("Monday", 2);
  assert.match(app(), /<div class="ws-crow set-skipped"><span class="ws-crow-label">Set 2<\/span><span class="ws-crow-value">Skipped<\/span><\/div>/);
});
