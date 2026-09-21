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
  assert.match(html, /alternateWorkout:\!\!session\.alternateWorkout,completionOnly:\!\!session\.completionOnly/);
});

test("alternate completion is idempotent and remains reachable with a draft", () => {
  assert.match(html, /id="alternate_"\+performedDate\+"_"\+String\(d\)\.toLowerCase\(\)+"_completion"/);
  assert.match(html, /existing=Object\.values\(db\.sessions\|\|\{\}\)\.find\(s=>s&&s\.id===id\)/);
  assert.match(html, /id="bt-resume-alternate">Complete as alternate workout/);
});

test("standalone warm-ups are excluded without deleting history", () => {
  assert.match(html, /function isStandaloneWarmupSession/);
  assert.match(html, /currentWeekCompletedSession\(d,reference=today\(\)\)\{return Object\.entries\(db\.sessions\|\|\{\}\)\.filter\(\(\[key,s\]\)=>s&&!isStandaloneWarmupSession\(s,key\)/);
  assert.match(html, /function weeklyProgress\(\)\{const sessions=.*isStandaloneWarmupSession/);
  assert.match(html, /Object\.entries\(db\.sessions\)\.filter\(\(\[key,s\]\)=>s&&!isStandaloneWarmupSession\(s,key\)/);
  assert.match(html, /Object\.entries\(db\.sessions\|\|\{\}\)\.filter\(\(\[key,s\]\)=>\{if\(isStandaloneWarmupSession\(s,key\)\)return false/);
});

test("same-week drafts are reused with explicit resume or discard", () => {
  assert.match(html, /function latestDraftForDay\(d,reference=today\(\)\)/);
  assert.match(html, /s\.status==="draft"&&sessionInProgramWeek\(s,reference\)/);
  assert.match(html, /const existing=activeSessionForDay\(d\)\|\|latestDraftForDay\(d\)\|\|currentActiveSession\(\)/);
  assert.match(html, /discardActiveAndStartNew\(d,s\)/);
});

test("alternate workouts are clearly labeled in weekly progress", () => {
  assert.match(html, /\(alternate\?"Alternate ":""\)/);
  assert.match(html, /Completed as an alternate workout\. No sets recorded/);
});

test("alternate duration survives migration/export and missing duration stays null", () => {
  assert.match(html, /function sessionDurationSec\(session\)\{const stored=numericOrNull\(session\?\.durationSec\);if\(\(session\?\.alternateWorkout\|\|session\?\.completionOnly\)&&stored!==null&&stored>0\)return stored;return derivedDurationSec\(session\)\}/);
  assert.match(html, /s\.durationSec=\(s\.alternateWorkout\|\|s\.completionOnly\)\?\(numericOrNull\(s\.durationSec\)>0\?numericOrNull\(s\.durationSec\):null\):derivedDurationSec\(s\)/);
  const validTimestamp = value => {
    const t = Date.parse(value || "");
    return Number.isFinite(t) ? t : null;
  };
  const numericOrNull = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const helperSource = html.match(/function derivedDurationSec\(session\)\{[^\n]+\}\nfunction sessionDurationSec\(session\)\{[^\n]+\}/)?.[0];
  assert.ok(helperSource, "duration helpers should be present");
  const sessionDurationSec = new Function("validTimestamp", "numericOrNull", helperSource + "\nreturn sessionDurationSec;")(validTimestamp, numericOrNull);
  assert.equal(sessionDurationSec({ alternateWorkout: true, durationSec: 2712, startedAt: null, endedAt: new Date().toISOString() }), 2712);
  assert.equal(sessionDurationSec({ alternateWorkout: true, durationSec: null, startedAt: null, endedAt: new Date().toISOString() }), null);
});
