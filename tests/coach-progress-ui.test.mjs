import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("Coach and Progress stay usable in a narrow mobile layout", () => {
  assert.match(index, /html,body\{overflow-x:hidden\}/);
  assert.match(index, /min-width:44px;min-height:44px/);
  assert.match(index, /min-height:44px;display:flex;align-items:center/);
  assert.match(index, /ChatGPT can propose changes from your signed-in data/);
  assert.match(index, /You review and approve every proposal/);
  assert.doesNotMatch(index, /broader coaching is a manual ChatGPT handoff/);
  assert.equal((index.match(/id="coach-inbox-card"/g) || []).length, 1);
  assert.match(index, /<summary>Automatic workout decisions<\/summary>/);
  assert.match(index, /<summary>Advanced \/ backup coaching<\/summary>/);
});

test("Progress has one primary weight action and no duplicate Coach inbox", () => {
  const start = index.indexOf("function progress()");
  const end = index.indexOf("function focusWeightCheckin", start);
  const progress = index.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(progress, /dashboardOverview\(\)\+weeklyProgress\(\)/);
  assert.match(progress, /id="pw"/);
  assert.match(progress, /Save weight check-in/);
  assert.match(progress, /Optional waist, activity, and notes/);
  assert.match(progress, /Advanced \/ backup/);
  assert.doesNotMatch(progress, /coach-inbox-card/);
});
