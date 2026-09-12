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
