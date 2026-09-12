import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = JSON.parse(fs.readFileSync(path.join(root, "program.json"), "utf8"));
const embeddedMatch = html.match(/const PROGRAM=(\{[\s\S]*\}),PROGRAM_VERSION="13\.0";/);
assert.ok(embeddedMatch, "embedded current program should be present");
const embedded = JSON.parse(embeddedMatch[1]);

test("embedded program and program.json stay in sync", () => {
  assert.deepEqual(embedded, source);
});

test("Monday prescription and title are exact", () => {
  assert.equal(source.Monday.title, "Monday — Squat + Bench");
  assert.deepEqual(source.Monday.exercises.map(x => [x.name, x.sets, x.min, x.max, x.rest]), [
    ["Back Squat", 3, 5, 8, 150],
    ["Barbell Bench Press", 3, 5, 8, 150],
    ["Lat Pulldown", 3, 8, 12, 90],
    ["1-Arm DB Row", 2, 8, 12, 75],
    ["Single-Arm Cable Lateral Raise", 2, 12, 20, 60],
    ["DB Hammer Curl", 2, 10, 15, 60]
  ]);
});

test("Friday places timed Dead Hang immediately after Pull-Ups", () => {
  const names = source.Friday.exercises.map(x => x.name);
  assert.deepEqual(names, ["Deadlift", "Pull-Ups", "Dead Hang", "Incline DB Bench", "Cable Row", "Walking Lunge", "DB Curl"]);
  const hang = source.Friday.exercises[2];
  assert.deepEqual([hang.sets, hang.min, hang.max, hang.rest, hang.unit], [2, 20, 45, 60, "sec"]);
  assert.match(hang.cue, /5–10 seconds in reserve/);
});

test("Saturday is the full-body hypertrophy template and stale exercises are absent", () => {
  assert.equal(source.Saturday.title, "Saturday — Full-Body Hypertrophy");
  assert.deepEqual(source.Saturday.exercises.map(x => [x.name, x.sets, x.min, x.max, x.rest]), [
    ["Leg Press", 3, 8, 12, 120],
    ["Barbell Romanian Deadlift", 2, 8, 10, 120],
    ["DB Shoulder Press", 3, 8, 12, 120],
    ["DB Flat Bench", 2, 8, 12, 120],
    ["DB Lateral Raise", 2, 12, 20, 60],
    ["Calf Raise", 2, 12, 20, 60]
  ]);
  const stale = ["Walking Lunge", "DB Romanian Deadlift", "Dead Hang"];
  assert.equal(stale.some(name => source.Saturday.exercises.some(x => x.name === name)), false);
});

test("unilateral exercises remain one set input per side-paired exercise", () => {
  const lateral = source.Monday.exercises.find(x => x.name === "Single-Arm Cable Lateral Raise");
  assert.deepEqual([lateral.unilateral, lateral.sides, lateral.analyticsSets], [true, 2, 2]);
  const lunge = source.Friday.exercises.find(x => x.name === "Walking Lunge");
  assert.equal(lunge.unilateral, undefined);
  assert.doesNotMatch(html, /repsPerSide.*additional input/);
});

test("non-lifting activities classify Tuesday, Wednesday, and Thursday separately", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(source.activities).map(([d, x]) => [d, x.type])), {
    Tuesday: "zone2", Wednesday: "yoga", Thursday: "walking", Sunday: "rest"
  });
  assert.deepEqual([source.activities.Tuesday.durationMin, source.activities.Tuesday.durationMax], [30, 40]);
  assert.equal(source.activities.Tuesday.stepsAverageTarget, 6000);
  assert.equal(source.activities.Wednesday.stepsAverageTarget, 6000);
  assert.equal(source.activities.Thursday.stepsAverageTarget, 6000);
  assert.match(html, /function toggleActivityCompletion\(d\)/);
  assert.match(html, /activityCompleted\(d/);
});

test("activity completion is reversible without creating lifting sessions", () => {
  const records = [];
  const complete = (day) => {
    const i = records.findIndex(x => x.programDay === day);
    if (i >= 0) records.splice(i, 1);
    else records.push({ programDay: day, status: "completed" });
  };
  complete("Tuesday");
  assert.deepEqual(records, [{ programDay: "Tuesday", status: "completed" }]);
  complete("Tuesday");
  assert.deepEqual(records, []);
  assert.doesNotMatch(html, /toggleActivityCompletion\(d\).*createWorkoutSession/);
  assert.match(html, /db\.recoveryActivities\.push/);
});

test("current guidance uses approximately 6,000 steps and excludes activities from lifting analytics", () => {
  assert.doesNotMatch(html, /8,000|10,000/);
  assert.match(html, /stepsAverageTarget.*6000/);
  assert.match(html, /function progressionCandidates\(sessions\)/);
  assert.match(html, /savedSessions:sessions/);
});

test("coach export/currentProgram includes activities while historical snapshots remain session-owned", () => {
  assert.match(html, /currentProgram:coachCurrentProgram\(\)/);
  assert.match(html, /activities:cloneValue\(PROGRAM\.activities\|\|\{\}\)/);
  assert.match(html, /programSnapshot:snapshot/);
  assert.match(html, /function sessionProgram\(d\)/);
});
