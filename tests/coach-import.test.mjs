import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("function coachValidationError");
const end = html.indexOf("function escapeHtml", start);
assert.ok(start >= 0 && end > start, "coach update validator must exist");
const context = {
  PROGRAM: { Monday: {}, Wednesday: {}, Friday: {}, Saturday: {} },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const minimal = () => ({
  schema: "body-transformation-coach-update-v1",
  sourcePackageId: "coach_test_1",
  coachSummary: "Approved coaching update for the current program.",
});
const plan = () => ({
  Monday: {
    title: "Monday — Lower + Push",
    subtitle: "Strength + hypertrophy",
    exercises: [{
      name: "Back Squat",
      type: "Compound",
      sets: 3,
      min: 5,
      max: 8,
      rest: 150,
      warm: "squat",
      unilateral: false,
      substitution: "Goblet Squat",
      unit: "reps",
      machine: "rack",
      loadType: "barbell",
    }],
  },
});

test("minimal Coach Update v1 payload succeeds", () => {
  assert.equal(context.validateCoachUpdatePayload(minimal()).sourcePackageId, "coach_test_1");
});

test("valid payload with nextWeekProgram succeeds", () => {
  assert.equal(context.validateCoachUpdatePayload({ ...minimal(), nextWeekProgram: plan() }).nextWeekProgram.Monday.exercises[0].sets, 3);
});

test("valid payload with targetGuidance succeeds", () => {
  const out = context.validateCoachUpdatePayload({ ...minimal(), targetGuidance: { calories: { min: 2300, max: 2400 }, protein: 200, stepsAverageTarget: 9000, zone2SessionsPerWeek: 2, zone2DurationMin: 25, zone2DurationMax: 35, preferredZone2Day: "Wednesday" } });
  assert.equal(out.targetGuidance.preferredZone2Day, "Wednesday");
});

test("valid payload with both optional fields succeeds", () => {
  assert.ok(context.validateCoachUpdatePayload({ ...minimal(), nextWeekProgram: plan(), targetGuidance: { calories: 2350, protein: 200 } }));
});

test("missing schema fails with a specific error", () => {
  assert.throws(() => context.validateCoachUpdatePayload({ sourcePackageId: "x", coachSummary: "ok" }), /schema is required/);
});

test("wrong schema value fails with a specific error", () => {
  assert.throws(() => context.validateCoachUpdatePayload({ ...minimal(), schema: "wrong" }), /schema must equal/);
});

test("missing sourcePackageId fails", () => {
  assert.throws(() => context.validateCoachUpdatePayload({ ...minimal(), sourcePackageId: " " }), /sourcePackageId must be a non-empty string/);
});

test("missing coachSummary fails", () => {
  assert.throws(() => context.validateCoachUpdatePayload({ ...minimal(), coachSummary: "" }), /coachSummary must be a non-empty string/);
});

test("malformed nextWeekProgram reports a path-level error", () => {
  const bad = plan();
  bad.Monday.exercises[0].sets = 0;
  assert.throws(() => context.validateCoachUpdatePayload({ ...minimal(), nextWeekProgram: bad }), /nextWeekProgram\.Monday\.exercises\[0\]\.sets/);
});

test("unknown harmless optional top-level fields do not fail import validation", () => {
  assert.equal(context.validateCoachUpdatePayload({ ...minimal(), futureField: { version: 2 } }).futureField.version, 2);
});
