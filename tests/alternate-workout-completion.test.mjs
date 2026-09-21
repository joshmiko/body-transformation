import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const supabaseSource = fs.readFileSync(path.join(root, "src", "supabase-rest.js"), "utf8");

test("alternate completion path is explicit, completion-only, and does not fabricate sets", () => {
  assert.match(html, /Complete as alternate workout/);
  assert.match(html, /openAlternateWorkoutDialog/);
  assert.match(html, /This marks the programmed day complete without inventing sets or progression data/);
  assert.match(html, /alternateWorkout:true,completionOnly:true/);
  assert.match(html, /exercises:{},stats:{workingSets:0,completedSets:0}/);
  assert.match(html, /durationSec:Number.isFinite(durationMin)/);
});

test("alternate completion is idempotent for the same day and date", () => {
  assert.match(html, /id="alternate_"\+performedDate\+"_"\+String(d).toLowerCase()\+"_completion"/);
  assert.match(html, /existing=Object.values(db.sessions\|\|{}).find(s=>s&&s.id===id)/);
  assert.match(html, /if(existing){closeAlternateWorkoutDialog();previewDay(d);return}/);
});

test("standalone warm-up records are excluded from completion/history/coaching paths", () => {
  assert.match(html, /function isStandaloneWarmupSession/);
  assert.match(html, /currentWeekCompletedSession(d,reference=today()){return Object.entries(db.sessions\|\|{}).filter(([key,s])=>s&&!isStandaloneWarmupSession(s,key)/);
  assert.match(html, /Object.entries(db.sessions).filter(([key,s])=>s&&!isStandaloneWarmupSession(s,key)/);
  assert.match(html, /Object.entries(db.sessions).filter(([key,s])=>{if(isStandaloneWarmupSession(s,key))return false/);
});

test("same-program-day current-week drafts are reused with an explicit resume/discard choice", () => {
  assert.match(html, /function latestDraftForDay(d,reference=today())/);
  assert.match(html, /s.status==="draft"&&sessionInProgramWeek(s,reference)/);
  assert.match(html, /const existing=activeSessionForDay(d)\|\|latestDraftForDay(d)\|\|currentActiveSession()/);
  assert.match(html, /discardActiveAndStartNew(d,s)/);
});

test("completion-only records count as a programmed completion but produce no progression signals", () => {
  const record = {
    programDay: "Monday",
    performedDate: "2026-09-14",
    status: "saved",
    finished: "2026-09-21T04:33:12.480Z",
    alternateWorkout: true,
    completionOnly: true,
    exercises: {}
  };
  const completed = ["Monday", "Friday", "Saturday"].filter(day => day === record.programDay || day === "Friday" || day === "Saturday");
  assert.equal(new Set(completed).size, 3);
  assert.equal(Object.keys(record.exercises).length, 0);
  assert.equal(record.alternateWorkout && record.completionOnly, true);
});

test("Supabase canonical sync filters warm-up child rows and preserves them non-destructively", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const supabase = await import("../src/supabase-rest.js?alternate-workout-test");
  assert.equal(supabase.isStandaloneWarmupSession({ id: "warm_2026-09-14_Monday_0_0" }), true);
  assert.equal(supabase.isStandaloneWarmupSession({ type: "warmup" }, "legacy-session"), true);
  assert.equal(supabase.isStandaloneWarmupSession({ id: "session-1", type: "draft" }), false);
  const local = { sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] };
  const merged = supabase.mergeCanonicalRecords(local, [{
    record_type: "workout_session",
    source_record_id: "warm_2026-09-14_Monday_0_0",
    payload: { id: "warm_2026-09-14_Monday_0_0", type: "warmup", status: "saved" },
    updated_at: "2026-09-14T10:00:00.000Z"
  }]);
  assert.deepEqual(merged.sessions, {});
});
