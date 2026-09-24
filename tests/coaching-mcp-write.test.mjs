import test from "node:test";
import assert from "node:assert/strict";
import {
  COACH_UPDATE_SCHEMA,
  isPastProgramEffectiveDate,
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
      warm: "squat",
      unilateral: false,
      substitution: "Leg press",
      unit: "reps",
      machine: "rack",
      loadType: "external"
    }]
  },
  Saturday: {
    title: "Lower",
    exercises: [{ name: "Dead Hang", type: "hang", sets: 2, min: 20, max: 45, rest: 60, unit: "sec" }]
  }
};
const weightEntries = [{ date: "2026-09-20", weightLb: 205.4 }, { date: "2026-09-19", weightLb: 206.1, note: "Morning" }];
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
test("programEffectiveDate accepts a real ISO local calendar date", () => {
  assert.equal(validateCoachUpdate({ ...minimal, nextWeekProgram: program, programEffectiveDate: "2026-09-25" }).programEffectiveDate, "2026-09-25");
  assert.throws(() => validateCoachUpdate({ ...minimal, programEffectiveDate: "2026-02-30" }), /programEffectiveDate.*real calendar date/);
  assert.throws(() => validateCoachUpdate({ ...minimal, programEffectiveDate: "09/25/2026" }), /programEffectiveDate.*ISO date/);
});
test("programEffectiveDate submission check compares date-only values deterministically", () => {
  assert.equal(isPastProgramEffectiveDate("2026-09-25", "2026-09-24"), false);
  assert.equal(isPastProgramEffectiveDate("2026-09-24", "2026-09-24"), false);
  assert.equal(isPastProgramEffectiveDate("2026-09-23", "2026-09-24"), true);
});
test("nextWeekProgram validates with supported workout and exercise fields", () => {
  const value = validateCoachUpdate({ ...minimal, nextWeekProgram: program });
  assert.equal(value.nextWeekProgram.Monday.exercises[0].name, "Squat");
  assert.equal(value.nextWeekProgram.Saturday.exercises[0].unit, "sec");
});
test("weightEntries validates, sorts by date, and normalizes missing notes", () => {
  const value = validateCoachUpdate({ ...minimal, weightEntries });
  assert.deepEqual(value.weightEntries, [
    { date: "2026-09-19", weightLb: 206.1, note: "Morning" },
    { date: "2026-09-20", weightLb: 205.4, note: "" }
  ]);
});
test("weightEntries rejects malformed dates, unrealistic values, duplicate dates, and over-limit requests", () => {
  assert.throws(() => validateCoachUpdate({ ...minimal, weightEntries: [{ date: "2026-02-30", weightLb: 200 }] }), /weightEntries\[0\]\.date/);
  assert.throws(() => validateCoachUpdate({ ...minimal, weightEntries: [{ date: "2026-09-20", weightLb: 49 }] }), /weightEntries\[0\]\.weightLb/);
  assert.throws(() => validateCoachUpdate({ ...minimal, weightEntries: [{ date: "2026-09-20", weightLb: 200 }, { date: "2026-09-20", weightLb: 201 }] }), /duplicates/);
  assert.throws(() => validateCoachUpdate({ ...minimal, weightEntries: Array.from({ length: 15 }, (_, i) => ({ date: "2026-09-"+String(i + 1).padStart(2, "0"), weightLb: 200 })) }), /weightEntries/);
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
