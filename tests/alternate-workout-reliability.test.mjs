import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("alternate completion is explicit and completion-only", () => {
  assert.match(html, /Complete as alternate workout/);
  assert.match(html, /This marks the programmed day complete without inventing sets or progression data/);
  assert.match(html, /alternateWorkout:true,completionOnly:true/);
  assert.match(html, /exercises:{},stats:{workingSets:0,completedSets:0}/);
  assert.match(html, /durationSec:Number\.isFinite\(durationMin\)/);
  assert.match(html, /Alternate /);
});

test("alternate completion is idempotent for the same day and date", () => {
  assert.match(html, /id="alternate_"\+performedDate\+"_"\+String\(d\)\.toLowerCase\(\)+"_completion"/);
  assert.match(html, /existing=Object\.values\(db\.sessions\|\|\{\}\)\.find\(s=>s&&s\.id===id\)/);
});

test("standalone warm-ups are excluded without deleting history", () => {
  assert.match(html, /function isStandaloneWarmupSession/);
  assert.match(html, /currentWeekCompletedSession\(d,reference=today\(\)\)\{return Object\.entries\(db\.sessions\|\|\{\}\)\.filter\(\(\[key,s\]\)=>s&&!isStandaloneWarmupSession\(s,key\)/);
  assert.match(html, /function weeklyProgress\(\)\{const sessions=.*isStandaloneWarmupSession/);
  assert.match(html, /Object\.entries\(db\.sessions\)\.filter\(\(\[key,s\]\)=>s&&!isStandaloneWarmupSession\(s,key\)/);
});

test("same-week drafts are reused with explicit resume or discard", () => {
  assert.match(html, /function latestDraftForDay\(d,reference=today\(\)\)/);
  assert.match(html, /s\.status==="draft"&&sessionInProgramWeek\(s,reference\)/);
  assert.match(html, /const existing=activeSessionForDay\(d\)\|\|latestDraftForDay\(d\)\|\|currentActiveSession\(\)/);
  assert.match(html, /discardActiveAndStartNew\(d,s\)/);
});

test("alternate workouts are clearly labeled in weekly progress", () => {
  assert.match(html, /alternate?"Alternate ":""/);
  assert.match(html, /Completed as an alternate workout\. No sets recorded/);
});
