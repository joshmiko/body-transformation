import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, programText] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../program.json", import.meta.url), "utf8"),
]);
const program = JSON.parse(programText);

test("workout duration is derived from timestamps before save", () => {
  assert.match(html, /function derivedDurationSec/);
  assert.match(html, /s\.durationSec=derivedDurationSec\(s\)/);
  const start = Date.parse("2026-08-31T17:15:28.779Z");
  const end = Date.parse("2026-08-31T18:21:49.674Z");
  assert.equal(Math.floor((end - start) / 1000), 3980);
});

test("review remains the gate before a workout is saved", () => {
  assert.match(html, /function finish\(d\)/);
  assert.match(html, /s\.status="review"/);
  assert.match(html, /function saveReviewedWorkout\(d\)/);
  assert.match(html, /s\.status="saved"/);
});

test("warm-ups remain separate from working-set completion", () => {
  assert.match(html, /ex\.warmups=Array\.isArray/);
  assert.match(html, /type:"warmup"/);
  assert.match(html, /type:"working"/);
  assert.match(html, /actual\.filter\(x=>x\.status!=="skipped"\)/);
});

test("coach sync keeps historical and current program context", () => {
  for (const marker of [
    "body-transformation-coaching-package-v2",
    "body-transformation-coach-update-v1",
    "programSnapshot",
    "currentProgram",
    "includedDataCutoff",
    "includedThrough",
    "sourcePackageId",
    "Keep current plan",
    "Apply next week",
  ]) assert.ok(html.includes(marker), `Missing Coach Sync contract: ${marker}`);
});

test("unilateral lateral raise and substitution remain prescribed", () => {
  const lateral = program.Monday.exercises.find(x => x.name === "Single-Arm Cable Lateral Raise");
  assert.equal(lateral?.sets, 2);
  assert.equal(lateral?.unilateral, true);
  assert.equal(lateral?.sides, 2);
  assert.equal(lateral?.substitution, "DB Lateral Raise");
  assert.ok(html.includes("prescribedExercise"));
  assert.ok(html.includes("performedExercise"));
});

test("nutrition keeps primary logging and history contracts", () => {
  for (const marker of [
    "nutritionStore",
    "nutritionTotals",
    "nutritionWeekSummary",
    "Quick add",
    "Add food",
    "Today’s entries",
    "Weekly adherence",
  ]) assert.ok(html.includes(marker), `Missing nutrition contract: ${marker}`);
});

test("missing RIR is not collected as an empty string", () => {
  assert.ok(!html.includes('placeholder="RIR"'));
  assert.ok(!html.includes('rir:""'));
});
