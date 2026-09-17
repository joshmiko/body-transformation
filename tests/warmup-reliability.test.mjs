import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const plateLoad = (value) => Math.max(45, Math.round(value / 5) * 5);
function practicalWarmups(name, load, options = {}) {
  const w = Number(load);
  if (name === "Back Squat") {
    const mid = plateLoad(Math.min(w - 35, Math.max(95, w * 0.65)));
    const top = plateLoad(Math.min(w - 20, Math.max(mid + 20, w * 0.83)));
    return [[45, w > 45 ? 9 : 5], [mid, 5], [top, 3]];
  }
  if (name === "Barbell Bench Press") {
    const mid = plateLoad(Math.min(w - 35, Math.max(75, w * 0.6)));
    const top = plateLoad(Math.min(w - 15, Math.max(mid + 20, w * 0.85)));
    return [[45, 8], [mid, 5], [top, 3]];
  }
  if (name === "Deadlift") {
    const floor = w >= 225 ? 135 : 45;
    const vals = [floor, plateLoad(w * 0.67), plateLoad(w * 0.82), plateLoad(w * 0.93)]
      .map((v, i) => Math.min(w - 5 * (4 - i), v));
    const out = [];
    vals.forEach((v, i) => {
      const x = Math.max(floor, plateLoad(v));
      if (!out.length || x > out.at(-1)[0]) out.push([x, [5, 3, 2, 1][i]]);
    });
    return out;
  }
  if (options.warm === "legpress") {
    const base = Number(options.machineBaseWeight) || 0;
    const added = Math.max(0, w - base);
    return [[base + Math.round(added * 0.6 / 10) * 10, 8]];
  }
  return [];
}

test("general treadmill warm-up is configured only for lifting days", () => {
  assert.match(html, /generalWarmup.*treadmill/);
  assert.equal((html.match(/"generalWarmup":\{"type":"treadmill"/g) || []).length, 3);
  assert.match(html, /d!==\"Wednesday\"&&p\?\.exercises\?\.length&&g/);
  assert.match(html, /function completeGeneralWarmup\(/);
  assert.match(html, /function skipGeneralWarmup\(/);
  assert.match(html, /function restoreGeneralWarmup\(/);
});

test("general warm-up lifecycle persists separate status and actual values", () => {
  assert.match(html, /generalWarmup:p\?\.generalWarmup\?/);
  assert.match(html, /actual:\{durationMin:null,speedMph:null,inclinePercent:null\}/);
  assert.match(html, /g\.status=\"completed\"/);
  assert.match(html, /g\.status=\"skipped\"/);
  assert.match(html, /generalWarmup:session\.generalWarmup\?/);
  let record = { status: "planned", actual: { durationMin: null, speedMph: null, inclinePercent: null } };
  record.status = "skipped";
  assert.equal(record.status, "skipped");
  record.status = "planned";
  assert.equal(record.status, "planned");
  record.actual = { durationMin: 5, speedMph: 3, inclinePercent: 3 };
  record.status = "completed";
  assert.deepEqual(record.actual, { durationMin: 5, speedMph: 3, inclinePercent: 3 });
});

test("accepted practical barbell warm-up examples", () => {
  assert.deepEqual(practicalWarmups("Deadlift", 275), [[135, 5], [185, 3], [225, 2], [255, 1]]);
  assert.deepEqual(practicalWarmups("Back Squat", 210), [[45, 9], [135, 5], [175, 3]]);
  assert.deepEqual(practicalWarmups("Barbell Bench Press", 160), [[45, 8], [95, 5], [135, 3]]);
});

test("generated barbell warm-up loads are five-pound plate-loadable totals", () => {
  for (const [name, load] of [["Deadlift", 225], ["Deadlift", 275], ["Back Squat", 205], ["Barbell Bench Press", 155]]) {
    for (const [weight] of practicalWarmups(name, load)) {
      assert.equal(weight % 5, 0);
      assert.ok(weight < load);
    }
  }
});

test("Matrix Leg Press uses explicit sled base and ten-pound added-load increments", () => {
  assert.match(html, /"machineBaseWeight":167/);
  assert.deepEqual(practicalWarmups("Leg Press", 367, { warm: "legpress", machineBaseWeight: 167 }), [[287, 8]]);
  assert.equal((287 - 167) % 10, 0);
});

test("dumbbell, cable, bodyweight, and accessory exercises get no automatic ramp", () => {
  for (const name of ["1-Arm DB Row", "Lat Pulldown", "Pull-Ups", "DB Hammer Curl"]) {
    assert.deepEqual(practicalWarmups(name, 100), []);
  }
  assert.match(html, /if\(e\.warm===\"legpress\"\)/);
});

test("historical sessions without generalWarmup remain readable and snapshots are not rewritten", () => {
  assert.match(html, /session\.generalWarmup\?/);
  assert.match(html, /if\(!session\.generalWarmup\)session\.generalWarmup=/);
  assert.doesNotMatch(html, /Object\.values\(out\.sessions\).*generalWarmup/);
});

test("current-week and Wednesday regression coverage remains wired", () => {
  assert.match(html, /function currentWeekCompletedSession\(/);
  assert.match(html, /function currentWeekYogaCompleted\(/);
  assert.match(html, /currentWeekRecoveryActivities\(/);
});


test("general warm-up undo, restore, and skip clear stale actual values", () => {
  const resetActual = (g) => { g.actual = { durationMin: null, speedMph: null, inclinePercent: null }; g.completedAt = null; };
  const complete = (g) => { g.actual = { durationMin: g.planned.durationMin ?? 5, speedMph: g.planned.speedMph ?? 3, inclinePercent: g.planned.inclinePercent ?? 3 }; g.status = "completed"; g.completedAt = "2026-09-12T10:00:00.000Z"; };
  const record = { status: "completed", planned: { durationMin: 5, speedMph: 3, inclinePercent: 3 }, actual: { durationMin: 8, speedMph: 3.4, inclinePercent: 4 }, completedAt: "2026-09-12T10:00:00.000Z" };
  resetActual(record); record.status = "planned";
  assert.deepEqual(record.actual, { durationMin: null, speedMph: null, inclinePercent: null });
  assert.equal(record.completedAt, null);
  complete(record); resetActual(record); record.status = "planned";
  assert.deepEqual(record.actual, { durationMin: null, speedMph: null, inclinePercent: null });
  complete(record);
  assert.deepEqual(record.actual, { durationMin: 5, speedMph: 3, inclinePercent: 3 });
  assert.equal(record.status, "completed");
  assert.match(html, /function resetGeneralWarmupActual\(g\)/);
  assert.match(html, /resetGeneralWarmupActual\(g\);g\.status="skipped"/);
  assert.match(html, /resetGeneralWarmupActual\(g\);g\.status="planned"/);
});

function productionWarmups() {
  const start = html.indexOf("function warmups(e,w){");
  const end = html.indexOf("\nfunction warmupCanBeAdded", start);
  assert.ok(start >= 0 && end > start, "production warmup function should be present");
  return Function("plateLoad", "return (" + html.slice(start, end) + ")")(plateLoad);
}

test("production warm-up generation matches Monday, Friday, and Saturday references", () => {
  const warmups = productionWarmups();
  assert.deepEqual(warmups({ name: "Back Squat" }, 205), [[45, 9], [135, 5], [170, 3]]);
  assert.deepEqual(warmups({ name: "Deadlift" }, 275), [[135, 5], [185, 3], [225, 2], [255, 1]]);
  assert.deepEqual(warmups({ name: "Barbell Romanian Deadlift" }, 155), [[95, 5], [135, 3]]);
  assert.deepEqual(warmups({ name: "Leg Press", warm: "legpress", machineBaseWeight: 167 }, 417), [[317, 8]]);
});

test("eligible warm-ups defer until a load exists and never auto-ramp accessories", () => {
  const warmups = productionWarmups();
  assert.deepEqual(warmups({ name: "Back Squat", warm: "squat" }, ""), []);
  assert.deepEqual(warmups({ name: "Lat Pulldown", warm: "cable" }, 120), []);
  assert.deepEqual(warmups({ name: "DB Shoulder Press", warm: "db" }, 45), []);
  assert.match(html, /warmupInitializationReason="deferred-no-load"/);
  assert.match(html, /warmupsExplicitEmpty/);
});

test("legacy active drafts can recover treadmill guidance without rewriting snapshots", () => {
  assert.match(html, /function repairActiveWarmupGuidance\(session,d\)/);
  assert.match(html, /session\.status!=="draft"/);
  assert.match(html, /warmupGuidanceProvenance="recovered-base-program"/);
  assert.match(html, /snapshot\.generalWarmup\|\|base\?\.generalWarmup/);
  assert.match(html, /preview-warmup/);
  assert.match(html, /Ramps available:/);
});

test("warm-up row actions preserve intentional skips/deletions and offer an empty-state add action", () => {
  assert.match(html, /warmupWasIntentionallyEmpty\(ex\)/);
  assert.match(html, /warmupInitializationReason="user-empty"/);
  assert.match(html, /warmupInitializationReason="user-added"/);
  assert.match(html, /warmupAddAvailable/);
  assert.match(html, /Add warm-up set/);
});

function productionFunction(startMarker, endMarker, names = [], values = []) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, startMarker + " should be present");
  return Function(...names, "return (" + html.slice(start, end) + ")")(...values);
}

test("active warm-up lifecycle defers, generates, and preserves skipped-empty intent", () => {
  const warmups = productionWarmups();
  const warmupCanBeAdded = productionFunction("function warmupCanBeAdded", "function warmupWasIntentionallyEmpty", ["warmups"], [warmups]);
  const intentional = productionFunction("function warmupWasIntentionallyEmpty", "function repairActiveWarmupGuidance", ["warmupCanBeAdded"], [warmupCanBeAdded]);
  const session = { status: "draft", exercises: {} };
  const getSession = () => session;
  const exerciseRecord = (_session, _i, e) => {
    if (!session.exercises[0]) session.exercises[0] = { name: e.name, warmups: [], warmupsInitialized: false };
    return session.exercises[0];
  };
  const migrateSet = (x, type) => { x.type = type; x.status = x.status || (x.done ? "completed" : "planned"); return x; };
  const rows = productionFunction("function warmupRows", "function warmupRecord", ["getSession", "exerciseRecord", "warmups", "wud", "migrateSet", "warmupWasIntentionallyEmpty", "warmupCanBeAdded"], [getSession, exerciseRecord, warmups, () => ({}), migrateSet, intentional, warmupCanBeAdded]);
  const exercise = { name: "Back Squat", warm: "squat" };
  assert.deepEqual(rows("Monday", 0, exercise, ""), []);
  assert.equal(session.exercises[0].warmupInitializationReason, "deferred-no-load");
  assert.deepEqual(rows("Monday", 0, exercise, 205).map(x => [x.weight, x.reps]), [[45, 9], [135, 5], [170, 3]]);
  session.exercises[0].warmups = [];
  session.exercises[0].warmupsInitialized = false;
  session.exercises[0].warmupsSkipped = true;
  assert.deepEqual(rows("Monday", 0, exercise, 205), []);
  assert.equal(session.exercises[0].warmupInitializationReason, "skipped");
  assert.equal(session.exercises[0].warmupsExplicitEmpty, true);
  const restore = productionFunction("function restoreWarmupGuidance", "function addWarmup", ["getSession", "sessionProgram", "exerciseRecord", "startWeight", "sets", "warmupRows", "save", "render"], [getSession, () => ({ exercises: [exercise] }), exerciseRecord, () => 205, () => [], rows, () => {}, () => {}]);
  restore("Monday", 0);
  assert.deepEqual(session.exercises[0].warmups.map(x => [x.weight, x.reps]), [[45, 9], [135, 5], [170, 3]]);
});

test("draft-only treadmill recovery leaves completed sessions and snapshots unchanged", () => {
  const program = { Monday: { generalWarmup: { type: "treadmill", durationMin: 5 }, exercises: [{}] } };
  const clone = value => JSON.parse(JSON.stringify(value));
  const repair = productionFunction("function repairActiveWarmupGuidance", "function generalWarmupPlan", ["PROGRAM", "planForDay", "cloneValue"], [program, d => program[d], clone]);
  const snapshot = { exercises: [{}] };
  const draft = { status: "draft", programSnapshot: clone(snapshot) };
  repair(draft, "Monday");
  assert.deepEqual(draft.programSnapshot, snapshot);
  assert.equal(draft.generalWarmup.type, "treadmill");
  const saved = { status: "saved", programSnapshot: clone(snapshot) };
  repair(saved, "Monday");
  assert.equal(saved.generalWarmup, undefined);
});

test("working sets and warm-ups remain separate for export/volume accounting", () => {
  const session = { exercises: { "0": { warmups: [{ type: "warmup", weight: 45, reps: 8, done: true }], actual: [{ type: "working", weight: 205, reps: 5, done: true }] } } };
  const working = Object.values(session.exercises).flatMap(ex => (ex.actual || []).filter(set => set.type === "working" && set.done));
  const warm = Object.values(session.exercises).flatMap(ex => (ex.warmups || []).filter(set => set.type === "warmup" && set.done));
  assert.equal(working.length, 1);
  assert.equal(working.reduce((sum, set) => sum + set.weight * set.reps, 0), 1025); // warm-ups do not enter working volume
  assert.equal(warm.length, 1); // but remain available to export separately
  assert.notEqual(working[0], warm[0]);
  assert.match(html, /warmups:/);
  assert.match(html, /actual:/);
});

test("all inline workout scripts parse before browser execution", () => {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .map(match => ({ attrs: match[1], source: match[2] }))
    .filter(item => item.source.trim());
  assert.ok(scripts.length >= 2);
  const workoutScript = scripts.find(item => item.source.includes("function render(d,ei)"));
  assert.ok(workoutScript, "the active workout render script must be found");
  assert.doesNotThrow(() => Function(workoutScript.source.replace(/^\s*import\s+[^;]+;\s*$/gm, "")));
  scripts.forEach(({ attrs, source }) => {
    const withoutStaticImports = source.replace(/^\s*import\s+[^;]+;\s*$/gm, "");
    if (/type\s*=\s*["']module["']/.test(attrs)) {
      assert.doesNotThrow(() => Function("return async function(){\n" + withoutStaticImports + "\n}"));
    } else {
      assert.doesNotThrow(() => Function(withoutStaticImports));
    }
  });
});
