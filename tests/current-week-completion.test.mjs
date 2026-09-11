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
    inWeek(session, reference)
  );
}

test("current-week helpers and local date boundaries are present", () => {
  assert.match(html, /function currentProgramWeekBounds\(/);
  assert.match(html, /function sessionPerformedDate\(/);
  assert.match(html, /function sessionInProgramWeek\(/);
  assert.match(html, /function currentWeekCompletedSession\(/);
  assert.match(html, /localDateKey\(start\)/);
});

test("workouts/home/preview use current-week completion and validated active pointer", () => {
  assert.match(html, /active=currentActiveSession\(\),inprog=!!\(active&&\(\(active\.programDay\|\|active\.day\)===d\)\),done=!!currentWeekCompletedSession\(d\)/);
  assert.match(html, /completed=scheduled\?currentWeekCompletedSession\(selected\):null,active=scheduled\?activeSessionForDay\(selected\):null/);
  assert.match(html, /const complete=!!currentWeekCompletedSession\(d\)/);
  assert.match(html, /const s=currentWeekCompletedSession\(d\),active=activeSessionForDay\(d\),label=active\?"Resume workout":s\?"Review workout":"Start workout"/);
  assert.match(html, /sessionInProgramWeek\(s,now\)/);
});

test("prior, current, and future week records are separated", () => {
  const sessions = [
    { programDay: "Friday", status: "saved", performedDate: "2026-09-04" },
    { programDay: "Friday", status: "saved", performedDate: "2026-09-11" },
    { programDay: "Friday", status: "saved", performedDate: "2026-09-18" }
  ];
  assert.equal(completedForDay(sessions, "Friday", new Date(2026, 8, 11)).length, 1);
  assert.equal(completedForDay(sessions, "Friday", new Date(2026, 8, 4)).length, 1);
  assert.equal(completedForDay(sessions, "Friday", new Date(2026, 8, 18)).length, 1);
});

test("active draft is not treated as completed and Monday performed Tuesday remains Monday", () => {
  const sessions = [
    { programDay: "Monday", status: "draft", performedDate: "2026-09-07" },
    { programDay: "Monday", status: "saved", performedDate: "2026-09-08" }
  ];
  assert.equal(completedForDay(sessions, "Monday", new Date(2026, 8, 8)).length, 1);
  assert.equal(completedForDay(sessions, "Monday", new Date(2026, 8, 8))[0].programDay, "Monday");
});

test("month/year and local Monday-Sunday boundaries are inclusive", () => {
  assert.deepEqual(weekBounds(new Date(2026, 0, 1)), { start: "2025-12-29", end: "2026-01-04" });
  assert.deepEqual(weekBounds(new Date(2026, 11, 31)), { start: "2026-12-28", end: "2027-01-03" });
  const edge = [
    { programDay: "Saturday", status: "saved", performedDate: "2026-09-12" },
    { programDay: "Saturday", status: "saved", performedDate: "2026-09-13" }
  ];
  const matching = completedForDay(edge, "Saturday", new Date(2026, 8, 12));
  assert.equal(matching.length, 2);
  assert.equal(matching.at(-1).performedDate, "2026-09-13");
});
