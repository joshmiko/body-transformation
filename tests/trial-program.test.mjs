import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const externalProgram = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));

function inlineProgram() {
  const start = html.indexOf("const PROGRAM=");
  const end = html.indexOf(',PROGRAM_VERSION=', start);
  assert.ok(start >= 0 && end > start);
  return JSON.parse(html.slice(start + "const PROGRAM=".length, end));
}

const program = inlineProgram();

test("inline and external program sources stay identical", () => {
  assert.deepEqual(program, externalProgram);
});

test("Monday remains unchanged", () => {
  const expected = [
    ["Back Squat", 3, 5, 8, 150],
    ["Barbell Bench Press", 3, 5, 8, 150],
    ["Lat Pulldown", 3, 8, 12, 90],
    ["1-Arm DB Row", 2, 8, 12, 75],
    ["Single-Arm Cable Lateral Raise", 2, 12, 20, 60],
    ["DB Hammer Curl", 2, 10, 15, 60]
  ];
  assert.deepEqual(program.Monday.exercises.map(e => [e.name, e.sets, e.min, e.max, e.rest]), expected);
});

test("Friday trial adds separately tracked rope triceps work after DB Curl", () => {
  const exercises = program.Friday.exercises;
  assert.deepEqual(exercises.slice(-2).map(e => e.name), ["DB Curl", "Rope Overhead Cable Triceps Extension"]);
  const triceps = exercises.at(-1);
  assert.deepEqual({ sets: triceps.sets, min: triceps.min, max: triceps.max, rest: triceps.rest, warm: triceps.warm, loadType: triceps.loadType }, { sets: 2, min: 10, max: 15, rest: 75, warm: "cable", loadType: "cable" });
  assert.equal(triceps.unit, "reps");
  assert.equal(program.Friday.exercises.filter(e => e.name === triceps.name).length, 1);
});

test("Saturday trial adds standalone seated leg curl immediately after RDL", () => {
  const exercises = program.Saturday.exercises;
  const rdl = exercises.findIndex(e => e.name === "Barbell Romanian Deadlift");
  assert.equal(exercises[rdl + 1].name, "Seated Leg Curl");
  const curl = exercises[rdl + 1];
  assert.deepEqual({ sets: curl.sets, min: curl.min, max: curl.max, rest: curl.rest, warm: curl.warm, loadType: curl.loadType }, { sets: 2, min: 10, max: 15, rest: 75, warm: "machine", loadType: "machine" });
  assert.equal(curl.supersetWith, undefined);
});

test("Tuesday core is explicit recovery guidance, not a lifting session", () => {
  const tuesday = program.activities.Tuesday;
  assert.equal(program.Tuesday, undefined);
  assert.equal(tuesday.coreGuidance.name, "Dead Bug");
  assert.deepEqual([tuesday.coreGuidance.sets, tuesday.coreGuidance.min, tuesday.coreGuidance.max, tuesday.coreGuidance.rest], [2, 8, 12, 60]);
  assert.equal(tuesday.coreGuidance.tracking, "recovery-activity-guidance");
  assert.equal(tuesday.exercises, undefined);
  assert.match(tuesday.detail, /Dead Bug.*2 sets of 8–12 per side/);
});

test("new exercise defaults do not invent load and progression increments remain explicit", () => {
  const defaultsStart = html.indexOf("const defaults=");
  const defaultsEnd = html.indexOf(";\nconst inc=", defaultsStart);
  const incStart = html.indexOf("const inc=", defaultsEnd);
  const incEnd = html.indexOf(";\nfunction cloneValue", incStart);
  const defaults = JSON.parse(html.slice(defaultsStart + "const defaults=".length, defaultsEnd));
  const increments = JSON.parse(html.slice(incStart + "const inc=".length, incEnd));
  assert.equal(defaults["Rope Overhead Cable Triceps Extension"], "");
  assert.equal(defaults["Seated Leg Curl"], "");
  assert.equal(increments["Rope Overhead Cable Triceps Extension"], 5);
  assert.equal(increments["Seated Leg Curl"], 5);
});

test("active drafts remain snapshot-owned while new sessions use the current program", () => {
  const start = html.indexOf("function sessionProgram(d)");
  const end = html.indexOf("function clearActiveSessionPointer", start);
  const sessionProgram = Function("getSession", "planForDay", "return (" + html.slice(start, end) + ")")(
    day => ({ programSnapshot: { title: "Historical Friday", exercises: [{ name: "Old exercise" }] } }),
    day => program[day]
  );
  assert.equal(sessionProgram("Friday").title, "Historical Friday");
  const historicalSnapshot = JSON.parse(JSON.stringify(sessionProgram("Friday")));
  assert.deepEqual(historicalSnapshot, { title: "Historical Friday", exercises: [{ name: "Old exercise" }] });
  assert.match(html, /programSnapshot:p/);
});

test("trial exercises export as normal working sets with their prescribed rest", () => {
  const workingStart = html.indexOf("function exportWorkingSet(x,e)");
  const exerciseStart = html.indexOf("function exportExercise(rec,e)", workingStart);
  const exportWorkingSet = Function("numericOrNull", "normalizeRir", "normalizeFeel", "return (" + html.slice(workingStart, exerciseStart) + ")")(
    value => value === null || value === undefined || value === "" ? null : Number(value),
    value => value,
    value => value
  );
  const end = html.indexOf("function exportSession(session)", exerciseStart);
  const exportExercise = Function("numericOrNull", "normalizeRir", "normalizeFeel", "exportWorkingSet", "return (" + html.slice(exerciseStart, end) + ")")(
    value => value === null || value === undefined || value === "" ? null : Number(value),
    value => value,
    value => value,
    exportWorkingSet
  );
  const exported = exportExercise(
    { planned: { sets: 2, min: 10, max: 15, rest: 75 }, actual: [{ weight: 35, reps: 12, done: true, status: "completed" }] },
    program.Friday.exercises.at(-1)
  );
  assert.equal(exported.planned.sets, 2);
  assert.equal(exported.planned.prescribedRestSec, 75);
  assert.equal(exported.workingSets[0].reps, 12);
});
