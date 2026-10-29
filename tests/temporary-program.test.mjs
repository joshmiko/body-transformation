import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { validateCoachUpdate } from "../supabase/functions/coaching-mcp/write-bridge.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("function programDayDate("), html.indexOf("function sessionProgram("));

function makePlanContext() {
  const db = {
    nextWeekProgram: { Thursday: { title: "Permanent Thursday", exercises: [] }, Saturday: { title: "Permanent Saturday", exercises: [{ name: "Squat" }] } },
    nextWeekProgramEffectiveDate: "2037-10-05",
    temporaryProgram: { startDate: "2037-10-21", endDate: "2037-10-25", days: {
      Thursday: { title: "Activity A", exercises: [{ name: "Row" }] },
      Saturday: { title: "Recovery", exercises: [] }
    } }
  };
  const context = { db, PROGRAM: {}, today: () => "2037-10-21", weekStart: value => {
    const date = new Date(value + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date;
  }, localDateKey: date => date.toISOString().slice(0, 10) };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

test("dated hockey override does not replace the permanent program", () => {
  const context = makePlanContext();
  assert.equal(context.planForDay("Thursday", "2037-10-22").title, "Activity A");
  assert.equal(context.planForDay("Saturday", "2037-10-24").title, "Recovery");
  assert.equal(context.planForDay("Saturday", "2037-10-31").title, "Permanent Saturday");
  assert.equal(context.planForDay("Thursday", "2037-10-29").title, "Permanent Thursday");
  assert.equal(context.planForDay("Thursday", "2037-10-15").title, "Permanent Thursday");
  assert.equal(context.db.nextWeekProgram.Saturday.title, "Permanent Saturday");
});

test("successive approved weeks move lifting days without changing historical plans", () => {
  const context = makePlanContext();
  context.db.weeklyPrograms = [
    { startDate: "2037-10-19", endDate: "2037-10-25", updatedAt: "2037-10-18T18:00:00Z", days: { Tuesday: { title: "First week lift", exercises: [{ name: "Row" }] }, Thursday: { title: "First week game", activityType: "hockey", exercises: [] } } },
    { startDate: "2037-10-26", endDate: "2037-11-01", updatedAt: "2037-10-25T18:00:00Z", days: { Wednesday: { title: "Second week lift", exercises: [{ name: "Squat" }] }, Thursday: { title: "Second week recovery", exercises: [] } } }
  ];
  assert.equal(context.planForDay("Tuesday", "2037-10-20").title, "First week lift");
  assert.equal(context.planForDay("Thursday", "2037-10-22").title, "First week game");
  assert.equal(context.planForDay("Wednesday", "2037-10-28").title, "Second week lift");
  assert.equal(context.planForDay("Thursday", "2037-10-29").title, "Second week recovery");
  assert.equal(context.planForDay("Saturday", "2037-11-07").title, "Permanent Saturday");
  assert.equal(context.db.nextWeekProgram.Saturday.title, "Permanent Saturday");
});

test("the saved game calendar is available by date and ignores invalid entries", () => {
  const context = makePlanContext();
  context.db.plannedEvents = [
    { id: "one", date: "2037-10-29", type: "hockey", title: "Game" },
    { id: "bad", date: "2037-02-30", type: "hockey", title: "Bad date" },
    { id: "other", date: "2037-10-29", type: "other", title: "Other" }
  ];
  assert.equal(context.gamesOnDate("2037-10-29").length, 1);
  assert.equal(context.upcomingGames("2037-10-21", 14)[0].id, "one");
});

test("next workout searches dated plans across a week boundary", () => {
  const context = { today: () => "2037-10-25", localDateKey: date => date.toISOString().slice(0, 10), planForDay: (day, date) => date === "2037-10-28" ? { title: "Wednesday lift", exercises: [{ name: "Row" }] } : { exercises: [] } };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf("function nextScheduledWorkout("), html.indexOf("function home(")), context);
  const next = context.nextScheduledWorkout("2037-10-25");
  assert.equal(next.day, "Wednesday");
  assert.equal(next.date, "2037-10-28");
});

test("approving a bounded proposal stores only the temporary slot", () => {
  const db = { nextWeekProgram: { Friday: { title: "Original Friday", exercises: [] } }, nextWeekProgramEffectiveDate: "2037-10-05", checkins: [], coachSync: {} };
  const state = { appliedRequests: [] };
  const context = {
    db,
    weeklyPrograms: () => db.weeklyPrograms || [],
    coachEffectiveDateIssue: () => "",
    coachProgramEffectiveDate: row => row.program_effective_date,
    applyCoachWeightEntries: () => ({ added: 0 }),
    cloneValue: value => structuredClone(value),
    coachSyncState: () => state,
    save: () => {},
    completeCoachProgram: () => { throw new Error("temporary proposal must not merge into permanent program"); }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf("function applyCoachRequestLocally("), html.indexOf("async function reviewCoachRequest(")), context);
  context.applyCoachRequestLocally({ id: "reviewed-test", program_effective_date: "2037-10-21", next_week_program: {
    __temporary: { endDate: "2037-10-25" }, Friday: { title: "Activity Friday", exercises: [] }
  } });
  assert.equal(db.nextWeekProgram.Friday.title, "Original Friday");
  assert.equal(db.temporaryProgram.days.Friday.title, "Activity Friday");
  assert.equal(db.temporaryProgram.endDate, "2037-10-25");
  assert.equal(db.weeklyPrograms.length, 1);
  assert.deepEqual(state.appliedRequests, ["reviewed-test"]);
});

test("temporary Coach proposals require valid bounded dates", () => {
  const base = {
    schema: "body-transformation-coach-update-v1",
    sourcePackageId: "weekly-schedule-test",
    coachSummary: "One week only",
    programEffectiveDate: "2037-10-21",
    nextWeekProgram: { __temporary: { endDate: "2037-10-25" }, Wednesday: { title: "Workout A", exercises: [] }, Thursday: { title: "Recovery", exercises: [] }, Friday: { title: "Workout B", exercises: [] }, Saturday: { title: "Game", exercises: [] }, Sunday: { title: "Recovery", exercises: [] } }
  };
  assert.equal(validateCoachUpdate(base).nextWeekProgram.__temporary.endDate, "2037-10-25");
  assert.throws(() => validateCoachUpdate({ ...base, nextWeekProgram: { ...base.nextWeekProgram, __temporary: { endDate: "2037-10-20" } } }), /must not precede/);
  assert.throws(() => validateCoachUpdate({ ...base, nextWeekProgram: { ...base.nextWeekProgram, __temporary: { endDate: "2037-11-30" } } }), /7 days/);
  assert.throws(() => validateCoachUpdate({ ...base, nextWeekProgram: { ...base.nextWeekProgram, Friday: undefined } }), /Friday/);
  assert.throws(() => validateCoachUpdate({ ...base, programEffectiveDate: undefined }), /required for a temporary program/);
});

test("Coach context and cloud sync retain the bounded program", () => {
  const bridge = fs.readFileSync(new URL("../supabase/functions/coaching-mcp/bridge.mjs", import.meta.url), "utf8");
  const mcp = fs.readFileSync(new URL("../supabase/functions/coaching-mcp/index.ts", import.meta.url), "utf8");
  const sync = fs.readFileSync(new URL("../src/supabase-rest.js", import.meta.url), "utf8");
  assert.match(bridge, /output\.temporaryProgram =/);
  assert.match(mcp, /temporaryProgram: temporaryProgramFrom\(records\)/);
  assert.match(sync, /merged\.temporaryProgram = value\.temporaryProgram \|\| null/);
  assert.match(html, /db\.temporaryProgram=entry/);
  assert.match(html, /db\.weeklyPrograms=/);
});
