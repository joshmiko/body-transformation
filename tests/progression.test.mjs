import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProgression } from "../src/progression.mjs";

const exercise = { name: "Deadlift", sets: 2, min: 5, max: 6, rest: 180, unit: "reps", loadType: "barbell" };
const goodSet = { status: "completed", done: true, weight: 285, reps: 6, feel: "Good", actualRestSec: 180 };
const record = sets => ({ performedExercise: "Deadlift", workingSets: sets });

test("recommends only a reviewed, modest increase after all prescribed sets succeed", () => {
  assert.deepEqual(evaluateProgression(exercise, record([goodSet, goodSet]), { incrementLb: 5 }).decision, "propose-increase");
  assert.equal(evaluateProgression(exercise, record([goodSet, goodSet]), { incrementLb: 5 }).suggestedWeightLb, 290);
});
test("holds skipped, missing, hard, mixed-load, and long-rest sets", () => {
  for (const sets of [
    [goodSet, { ...goodSet, status: "planned" }],
    [goodSet],
    [goodSet, { ...goodSet, feel: "Hard" }],
    [goodSet, { ...goodSet, weight: 295 }],
    [goodSet, { ...goodSet, actualRestSec: 440 }]
  ]) assert.equal(evaluateProgression(exercise, record(sets), { incrementLb: 5 }).decision, "hold");
});
test("failure requires review, not an automatic heavier weight", () => {
  assert.equal(evaluateProgression(exercise, record([goodSet, { ...goodSet, feel: "Failed" }]), { incrementLb: 5 }).decision, "review-reduction");
});
test("substitutions and different machines never borrow the planned load", () => {
  assert.equal(evaluateProgression(exercise, { ...record([goodSet, goodSet]), performedExercise: "T Bar Row" }, { incrementLb: 5 }).decision, "hold");
  assert.equal(evaluateProgression({ ...exercise, machine: "Matrix" }, record([goodSet, goodSet]), { performedMachine: "Other", incrementLb: 5 }).decision, "hold");
});
test("bodyweight and oversized jumps need review", () => {
  assert.equal(evaluateProgression({ ...exercise, loadType: "bodyweight" }, record([goodSet, goodSet]), { incrementLb: 5 }).decision, "review-bodyweight");
  assert.equal(evaluateProgression(exercise, record([goodSet, goodSet]), { incrementLb: 40 }).decision, "hold");
});
