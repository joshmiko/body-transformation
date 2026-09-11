import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function weekBounds(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const start = new Date(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  return { start: localDateKey(start), end: localDateKey(end) };
}
function inWeek(session, reference) {
  const performed = session.performedDate || session.date;
  const bounds = weekBounds(reference);
  return typeof performed === "string" && performed >= bounds.start && performed <= bounds.end;
}
function completedForDay(sessions, day, reference) {
  return sessions.filter((session) =>
    (session.programDay || session.day) === day &&
    (session.status === "saved" || !!session.finished) &&
    (session.finished || session.endedAt) &&
    inWeek(session, reference)
  );
}
function visibleState({ lifting = true, active = false, complete = false, yoga = false } = {}) {
  if (!lifting) return { home: yoga ? "Completed — Undo" : "Mark Yoga / Recovery complete", workouts: yoga ? "COMPLETED" : "›", preview: yoga ? "Recovery complete" : "Start recovery" };
  const kind = active ? "active" : complete ? "completed" : "available";
  return {
    home: kind === "active" ? "Resume Workout" : kind === "completed" ? "Review Workout" : "Preview Workout",
    workouts: kind === "active" ? "IN PROGRESS" : kind === "completed" ? "COMPLETED" : "›",
    preview: kind === "active" ? "Resume workout" : kind === "completed" ? "Review workout" : "Start workout"
  };
}

test("current-week helpers and local date boundaries are present", () => {
  assert.match(html, /function currentProgramWeekBounds\(/);
  assert.match(html, /function sessionPerformedDate\(/);
  assert.match(html, /function sessionInProgramWeek\(/);
  assert.match(html, /function currentWeekCompletedSession\(/);
  assert.match(html, /localDateKey\(start\)/);
});

test("rendered state matrix keeps Home, Workouts, and preview consistent", () => {
  assert.match(html, /function workoutDayState\(/);
  assert.match(html, /state\.kind===\"active\"\?\"Resume Workout\"/);
  assert.match(html, /state\.kind===\"completed\"\?\"Review Workout\"/);
  assert.match(html, /d===\"Wednesday\"\?currentWeekYogaCompleted\(\):workoutDayState\(d\)\.kind===\"completed\"/);
  assert.deepEqual(visibleState(), { home: "Preview Workout", workouts: "›", preview: "Start workout" });
  assert.deepEqual(visibleState({ complete: true }), { home: "Review Workout", workouts: "COMPLETED", preview: "Review workout" });
  assert.deepEqual(visibleState({ active: true, complete: true }), { home: "Resume Workout", workouts: "IN PROGRESS", preview: "Resume workout" });
  assert.deepEqual(visibleState({ lifting: false }), { home: "Mark Yoga / Recovery complete", workouts: "›", preview: "Start recovery" });
  assert.deepEqual(visibleState({ lifting: false, yoga: true }), { home: "Completed — Undo", workouts: "COMPLETED", preview: "Recovery complete" });
});


test("prior, current, and future week records are separated", () => {
  const sessions = [
    { programDay: "Friday", status: "saved", performedDate: "2026-09-04", finished: "2026-09-04T18:00:00Z" },
    { programDay: "Friday", status: "saved", performedDate: "2026-09-11", finished: "2026-09-11T18:00:00Z" },
    { programDay: "Friday", status: "saved", performedDate: "2026-09-18", finished: "2026-09-18T18:00:00Z" }
  ];
  assert.equal(completedForDay(sessions, "Friday", new Date(2026, 8, 11)).length, 1);
  assert.equal(completedForDay(sessions, "Friday", new Date(2026, 8, 4)).length, 1);
  assert.equal(completedForDay(sessions, "Friday", new Date(2026, 8, 18)).length, 1);
});

test("active draft is not treated as completed and Monday performed Tuesday remains Monday", () => {
  const sessions = [
    { programDay: "Monday", status: "draft", performedDate: "2026-09-07" },
    { programDay: "Monday", status: "saved", performedDate: "2026-09-08", finished: "2026-09-08T18:00:00Z" }
  ];
  assert.equal(completedForDay(sessions, "Monday", new Date(2026, 8, 8)).length, 1);
  assert.equal(completedForDay(sessions, "Monday", new Date(2026, 8, 8))[0].programDay, "Monday");
});

test("month/year and local Monday-Sunday boundaries are inclusive", () => {
  assert.deepEqual(weekBounds(new Date(2026, 0, 1)), { start: "2025-12-29", end: "2026-01-04" });
  assert.deepEqual(weekBounds(new Date(2026, 11, 31)), { start: "2026-12-28", end: "2027-01-03" });
  const edge = [
    { programDay: "Saturday", status: "saved", performedDate: "2026-09-12", finished: "2026-09-12T18:00:00Z" },
    { programDay: "Saturday", status: "saved", performedDate: "2026-09-13", finished: "2026-09-13T18:00:00Z" }
  ];
  const matching = completedForDay(edge, "Saturday", new Date(2026, 8, 12));
  assert.equal(matching.length, 2);
  assert.equal(matching.at(-1).performedDate, "2026-09-13");
});

test("Wednesday recovery completion is date-specific, reversible, and separate from lifting adherence", () => {
  assert.match(html, /recoveryActivities/);
  assert.match(html, /programDay===\"Wednesday\"/);
  assert.match(html, /toggleYogaCompletion/);
  assert.match(html, /currentWeekYogaCompleted/);
  assert.match(html, /yogaCompleted:recoveryActivities\.length\?true/);
  assert.match(html, /Training adherence/);
});

test("legacy yogaCompleted check-ins are limited to their own week", () => {
  const legacy = [
    { date: "2026-08-26", yogaCompleted: true },
    { date: "2026-09-09", yogaCompleted: true }
  ];
  const activeWeek = legacy.filter((x) => x.yogaCompleted && inWeek({ performedDate: x.date }, new Date(2026, 8, 9)));
  assert.equal(activeWeek.length, 1);
  assert.equal(activeWeek[0].date, "2026-09-09");
});

test("malformed saved records without completion timestamps do not count", () => {
  const malformed = [{ programDay: "Friday", status: "saved", performedDate: "2026-09-11" }];
  assert.equal(completedForDay(malformed, "Friday", new Date(2026, 8, 11)).length, 0);
});

test("drafts with an end timestamp still do not count as completed", () => {
  const draft = [{ programDay: "Friday", status: "draft", performedDate: "2026-09-11", endedAt: "2026-09-11T18:00:00Z" }];
  assert.equal(completedForDay(draft, "Friday", new Date(2026, 8, 11)).length, 0);
});
