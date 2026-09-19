import test from "node:test";
import assert from "node:assert/strict";
import {
  COACH_UPDATE_SCHEMA,
  normalizeExpectedWatermark,
  payloadHash,
  validateCoachUpdate
} from "../supabase/functions/coaching-mcp/write-bridge.mjs";

const minimal = {
  schema: COACH_UPDATE_SCHEMA,
  sourcePackageId: "coach_test_1",
  coachSummary: "Approved coaching update."
};
const program = {
  Monday: {
    title: "Strength",
    subtitle: "Primary lift",
    exercises: [{
      name: "Squat",
      type: "barbell",
      sets: 3,
      min: 5,
      max: 8,
      rest: 150,
      warm: [{ weight: 45, reps: 8 }],
      unilateral: false,
      substitution: "Leg press",
      unit: "reps",
      machine: "rack",
      loadType: "external"
    }]
  },
  Saturday: {
    title: "Lower",
    exercises: [{ name: "Dead Hang", type: "hang", sets: 2, min: 20, max: 45, unit: "sec" }]
  }
};
const guidance = {
  calories: { min: 2200, max: 2400 },
  protein: 180,
  stepsAverageTarget: 9000,
  zone2SessionsPerWeek: 2,
  zone2DurationMin: 20,
  zone2DurationMax: 35,
  preferredZone2Day: "Thursday"
};

test("minimal coach update validates", () => {
  assert.deepEqual(validateCoachUpdate(minimal), minimal);
});
test("nextWeekProgram validates with supported workout and exercise fields", () => {
  const value = validateCoachUpdate({ ...minimal, nextWeekProgram: program });
  assert.equal(value.nextWeekProgram.Monday.exercises[0].name, "Squat");
  assert.equal(value.nextWeekProgram.Saturday.exercises[0].unit, "sec");
});
test("targetGuidance validates", () => {
  const value = validateCoachUpdate({ ...minimal, targetGuidance: guidance });
  assert.equal(value.targetGuidance.stepsAverageTarget, 9000);
});
test("both optional fields validate and unknown optional fields are ignored", () => {
  const value = validateCoachUpdate({ ...minimal, nextWeekProgram: program, targetGuidance: guidance, futureHint: { safe: true } });
  assert.ok(value.nextWeekProgram && value.targetGuidance);
  assert.equal(value.futureHint, undefined);
});
for (const [name, payload, message] of [
  ["missing schema", { ...minimal, schema: undefined }, "schema"],
  ["wrong schema", { ...minimal, schema: "wrong" }, "schema"],
  ["missing source id", { ...minimal, sourcePackageId: "" }, "sourcePackageId"],
  ["missing summary", { ...minimal, coachSummary: "" }, "coachSummary"]
]) {
  test(name + " fails with a specific path", () => assert.throws(() => validateCoachUpdate(payload), new RegExp(message)));
}
test("malformed program returns a path-level error", () => {
  assert.throws(
    () => validateCoachUpdate({ ...minimal, nextWeekProgram: { Monday: { exercises: [{ name: "Squat", sets: 0 }] } } }),
    /nextWeekProgram\.Monday\.exercises\[0\]\.sets/
  );
});
test("hashes are stable and watermark normalization is strict", () => {
  assert.equal(payloadHash({ b: 2, a: 1 }), payloadHash({ a: 1, b: 2 }));
  assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }));
  assert.equal(normalizeExpectedWatermark("2026-09-19T10:00:00-04:00"), "2026-09-19T14:00:00.000Z");
  assert.throws(() => normalizeExpectedWatermark("not-a-date"), /expectedWatermark/);
});
