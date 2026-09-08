import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("program templates and dated session instances are separate", () => {
  for (const marker of [
    "function migrateSessionLifecycle",
    "sessionSchemaVersion=2",
    "function createWorkoutSession",
    "sessionId:id",
    "programDay:d",
    "performedDate",
    "programSnapshot:p",
    "currentExerciseIndex:0",
    "currentSetIndex:0"
  ]) assert.ok(html.includes(marker), marker);
  assert.match(html, /function beginWorkout\(d\)[\s\S]*?createWorkoutSession\(d,today\(\)/);
});

test("startup validates active pointer and never resumes saved sessions", () => {
  assert.match(html, /function validateActiveSessionOnStartup\(\)[\s\S]*?\["draft","review"\]/);
  assert.match(html, /function currentActiveSession\(\)[\s\S]*?clearActiveSessionPointer/);
  assert.match(html, /function saveReviewedWorkout\(d\)[\s\S]*?clearActiveSessionPointer\(\);save\(\)/);
  assert.match(html, /function beginWorkout\(d\)[\s\S]*?currentActiveSession\(\)/);
});

test("cancel clears only the active session and preserves saved history", () => {
  assert.match(html, /function cancelActiveWorkout\(d\)[\s\S]*?delete db\.sessions\[s\.sessionId\|\|s\.id\]/);
  assert.match(html, /function cancelActiveWorkout\(d\)[\s\S]*?clearActiveSessionPointer\(\)/);
  assert.match(html, /function cancelActiveWorkout\(d\)[\s\S]*?previewDay\(d\)/);
});

test("manual completed workout import has a visible path and duplicate protection", () => {
  for (const marker of [
    "function importManualWorkout",
    "function manualImportKey",
    "manualImportKey:key",
    "manualImport:true",
    "function openManualWorkoutImport",
    "Add Completed Workout",
    "Workout imported successfully."
  ]) assert.ok(html.includes(marker), marker);
  assert.match(html, /function importManualWorkout\(payload\)[\s\S]*?duplicate/);
  assert.match(html, /function importManualWorkout\(payload\)[\s\S]*?status:"saved"/);
});

test("manual import preserves program day versus performed date and feeds normal export", () => {
  assert.match(html, /programDay,day:programDay,performedDate,date:performedDate/);
  assert.match(html, /function exportSession\(session\)[\s\S]*?session\.programSnapshot/);
  assert.match(html, /dashboardData\([\s\S]*?Object\.values\(db\.sessions\|\|\{\}\)/);
});
