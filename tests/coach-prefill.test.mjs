import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const from = html.indexOf("function sets(d,i,n)");
const to = html.indexOf("const HISTORY=", from);
const weightFrom = html.indexOf("function startWeight(e,s)");
const weightTo = html.indexOf("function plateLoad", weightFrom);
assert.ok(from >= 0 && to > from && weightFrom >= 0 && weightTo > weightFrom);

function harness(exercise, existing = []) {
  const rec = { actual: existing };
  const context = {
    exercise,
    rec,
    sessionProgram: () => ({ exercises: [exercise] }),
    getSession: () => ({}),
    exerciseRecord: () => rec,
    migrateSet: () => {},
    previousActual: () => [{ w: 155 }],
    hist: () => null,
    defaults: { "Barbell Bench Press": 155 },
    save: () => {},
    render: () => {},
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to) + html.slice(weightFrom, weightTo), context);
  return context;
}

const exercise = { name: "Barbell Bench Press", sets: 3, min: 5, max: 8, rest: 150, loadType: "barbell", coachLoad: { weightLb: 165, optionalWeightLb: 170, condition: "Warm-ups feel solid" } };

test("approved load prefills every new working set and is not silently advanced mid-session", () => {
  const h = harness(exercise);
  const rows = h.sets("Monday", 0, 3);
  assert.deepEqual(Array.from(rows, x => x.weight), [165, 165, 165]);
  rows[0].done = true;rows[0].status = "completed";rows[0].reps = 8;rows[0].feel = "Good";
  assert.equal(h.target(exercise, rows).w, 165);
});
test("manual weight edits beat the optional Coach choice", () => {
  const h = harness(exercise);
  const rows = h.sets("Monday", 0, 3);
  rows[0].weight = 160;rows[0].weightEdited = true;
  h.useOptionalCoachLoad("Monday", 0);
  assert.deepEqual(Array.from(rows, x => x.weight), [160, 170, 170]);
});
test("older programs still use the last performed load", () => {
  const old = { ...exercise, coachLoad: undefined };
  const h = harness(old);
  assert.equal(h.startWeight(old, []), 155);
});
