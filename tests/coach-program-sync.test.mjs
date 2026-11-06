import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const programBuilder = html.match(/^function coachCurrentProgram\(\).*$/m)?.[0];
const programStage = html.match(/^function stageProgramState\(\).*$/m)?.[0];
const cloudApply = html.match(/^window\.btApplySupabaseDb=.*$/m)?.[0];

test("ordinary saves do not advance the program revision", () => {
  assert.ok(programBuilder);
  assert.ok(programStage);
  const previous = { revision: 1, updatedAt: "2026-11-03T18:00:00Z", weeklyPrograms: [] };
  const context = {
    db: { programState: previous, programStateUpdatedAt: previous.updatedAt, weeklyPrograms: [], nextWeekProgram: { Friday: { title: "Old Friday" } } },
    completeCoachProgram: () => ({ Friday: { title: "Old Friday" } }),
    weeklyPrograms: () => context.db.weeklyPrograms,
    plannedGames: () => [],
    cloneValue: value => JSON.parse(JSON.stringify(value)),
    globalThis: {}
  };
  vm.createContext(context);
  vm.runInContext(programBuilder + "\n" + programStage, context);
  context.coachCurrentProgram();
  assert.equal(context.db.programState, previous);
  context.db.weeklyPrograms = [{ requestId: "approved-week", startDate: "2026-11-02", endDate: "2026-11-08", days: {} }];
  context.db.lastCoachRequestId = "approved-week";
  context.db.programStateUpdatedAt = "2026-11-03T18:32:53Z";
  context.coachCurrentProgram();
  assert.equal(context.db.programState, previous);
  context.stageProgramState();
  assert.equal(context.db.programState.revision, 2);
  assert.equal(context.db.programState.lastCoachRequestId, "approved-week");
  context.coachCurrentProgram();
  assert.equal(context.db.programState.revision, 2);
});

test("cloud refresh keeps an active workout on screen", () => {
  assert.ok(cloudApply);
  let homeCalls = 0;
  let statusCalls = 0;
  const context = {
    window: {},
    db: {},
    activeWorkoutDay: "Friday",
    migrateDb: value => value,
    migrateSessionLifecycle: value => value,
    persistLocalDb: () => {},
    activeSessionForDay: () => ({ id: "active-workout" }),
    refreshWorkoutSyncLabels: () => { statusCalls++; },
    home: () => { homeCalls++; }
  };
  vm.createContext(context);
  vm.runInContext(cloudApply, context);
  context.window.btApplySupabaseDb({ sessions: { "active-workout": { id: "active-workout" } } });
  assert.equal(homeCalls, 0);
  assert.equal(statusCalls, 1);
  assert.ok(context.db.sessions["active-workout"]);
});

test("Coach request stays pending until the cloud confirms its request ID", () => {
  const review = html.slice(html.indexOf("async function reviewCoachRequest("), html.indexOf("function progress()"));
  const apply = review.indexOf("await applyCoachRequestLocally(current)");
  const confirm = review.indexOf("await window.btSupabase.getCanonicalProgramState()");
  const mark = review.indexOf('status:"applied"');
  assert.ok(apply >= 0 && confirm > apply && mark > confirm);
  assert.match(review, /cloudProgram\?\.lastCoachRequestId!==current\.id/);
});
