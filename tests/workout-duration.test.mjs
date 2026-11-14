import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractLine(name) {
  const match = html.match(new RegExp(`^function ${name}\\([^\\n]*$`, "m"));
  assert.ok(match, `${name} should exist`);
  return match[0];
}

// Duration helpers + migrateDb run for real; unrelated app globals are stubbed.
function loadApp(nowIso) {
  const RealDate = Date;
  const fixedNow = nowIso ? RealDate.parse(nowIso) : null;
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow ?? RealDate.now()])); }
    static now() { return fixedNow ?? RealDate.now(); }
  }
  const start = html.indexOf("function cloneValue(");
  const end = html.indexOf("\n", html.indexOf("function migrateDb("));
  const context = {
    Date: FakeDate,
    PROGRAM: {},
    progressWeekKey: value => String(value).slice(0, 10),
    nutritionStoredValue: value => (value == null ? null : Number(value)),
    db: {},
    saved: 0,
    rendered: null,
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end) + "\n" + extractLine("elapsedSeconds") + "\n" + extractLine("resumeDraft"), context);
  return context;
}

const set = (completedAt, extra = {}) => ({ type: "working", done: true, status: "completed", completedAt, ...extra });
const planned = () => ({ type: "working", done: false, status: "planned", completedAt: null });

test("resume after a 3-day gap does not count the gap as workout time (Nov 3 → Nov 6 case)", () => {
  const app = loadApp("2026-11-06T18:30:00.000Z");
  const session = {
    id: "s1", sessionId: "s1", programDay: "Monday", status: "review",
    startedAt: "2026-11-03T19:00:00.000Z", endedAt: "2026-11-03T19:05:00.000Z", durationSec: 300, pausedTotalSec: 0,
    exercises: { 0: { actual: [planned(), planned()], warmups: [] } },
  };
  Object.assign(app, {
    activeSessionForDay: () => session,
    getSession: () => session,
    beginWorkout: () => assert.fail("should resume, not begin"),
    reviewWorkout: () => assert.fail("should resume, not review"),
    save: () => { app.saved++; },
    planForDay: () => ({ exercises: [{}] }),
    render: (d, i) => { app.rendered = [d, i]; },
  });

  app.resumeDraft("Monday");
  assert.equal(session.status, "draft");
  assert.equal(session.endedAt, null);
  assert.equal(session.durationSec, null);
  assert.equal(app.db.activeSessionId, "s1");
  assert.deepEqual(app.rendered, ["Monday", 0]);
  const gap = (Date.parse("2026-11-06T18:30:00Z") - Date.parse("2026-11-03T19:00:00Z")) / 1000;
  assert.equal(session.pausedTotalSec, gap);

  // Two sets logged, then finished — matches the production timestamps that saved 257441 s.
  session.exercises[0].actual = [set("2026-11-06T18:30:15.000Z"), set("2026-11-06T18:30:35.000Z")];
  session.endedAt = "2026-11-06T18:30:41.000Z";
  assert.equal((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000, 257441, "old wall-clock result");
  assert.equal(app.applyFinishedDuration(session), 41);
  assert.equal(session.durationEstimated, undefined);
  assert.equal(app.elapsedSeconds(session), 41, "live clock and saved duration agree");
});

test("resuming twice does not count the same idle gap twice", () => {
  const app = loadApp();
  const session = { startedAt: "2026-11-03T19:00:00.000Z", pausedTotalSec: 0, exercises: {} };
  const first = app.applyResumeIdleGap(session, Date.parse("2026-11-06T18:30:00Z"));
  assert.ok(first > 0);
  assert.equal(app.applyResumeIdleGap(session, Date.parse("2026-11-06T18:40:00Z")), 0);
  assert.equal(session.pausedTotalSec, first);
});

test("resume within 2 hours of the last set keeps the gap as workout time", () => {
  const app = loadApp();
  const session = {
    startedAt: "2026-11-10T18:00:00.000Z", pausedTotalSec: 0,
    exercises: { 0: { actual: [set("2026-11-10T18:40:00.000Z")], warmups: [] } },
  };
  assert.equal(app.applyResumeIdleGap(session, Date.parse("2026-11-10T19:30:00Z")), 0);
  assert.equal(session.pausedTotalSec, 0);
});

test("a normal session with a pause subtracts the pause, matching the live clock", () => {
  const app = loadApp();
  const closed = { startedAt: "2026-11-10T18:00:00.000Z", endedAt: "2026-11-10T19:00:00.000Z", pausedTotalSec: 600, exercises: {} };
  assert.equal(app.derivedDurationSec(closed), 3000);
  assert.equal(app.elapsedSeconds(closed), 3000);
  assert.equal(app.applyFinishedDuration(closed), 3000);
  assert.equal(closed.durationEstimated, undefined);

  const stillPaused = { startedAt: "2026-11-10T18:00:00.000Z", endedAt: "2026-11-10T19:00:00.000Z", pausedAt: "2026-11-10T18:50:00.000Z", pausedTotalSec: 0, exercises: {} };
  assert.equal(app.derivedDurationSec(stillPaused), 3000);
  assert.equal(app.elapsedSeconds(stillPaused), 3000);
});

test("a session over 4 hours falls back to first-to-last set time and is marked estimated", () => {
  const app = loadApp();
  const session = {
    startedAt: "2026-11-10T08:00:00.000Z", endedAt: "2026-11-10T13:30:00.000Z", pausedTotalSec: 0,
    exercises: {
      0: { warmups: [set("2026-11-10T08:10:00.000Z", { type: "warmup" })], actual: [set("2026-11-10T08:20:00.000Z"), set("2026-11-10T08:30:00.000Z", { status: "skipped", done: false })] },
      1: { warmups: [], actual: [set("2026-11-10T08:55:00.000Z"), planned()] },
    },
  };
  assert.equal(app.applyFinishedDuration(session), 45 * 60);
  assert.equal(session.durationSec, 45 * 60);
  assert.equal(session.durationEstimated, true);

  const oneSet = { startedAt: "2026-11-10T08:00:00.000Z", endedAt: "2026-11-10T13:30:00.000Z", exercises: { 0: { actual: [set("2026-11-10T08:20:00.000Z")] } } };
  assert.equal(app.applyFinishedDuration(oneSet), null, "no span to estimate from → unknown, not 5.5 h");
  assert.equal(oneSet.durationEstimated, true);

  const justUnder = { startedAt: "2026-11-10T08:00:00.000Z", endedAt: "2026-11-10T11:59:00.000Z", exercises: {} };
  assert.equal(app.applyFinishedDuration(justUnder), 239 * 60);
  assert.equal(justUnder.durationEstimated, undefined);
});

test("saved sessions keep their stored duration on load", () => {
  const app = loadApp();
  const input = {
    sessions: {
      nov3: {
        id: "nov3", programDay: "Monday", status: "saved",
        startedAt: "2026-11-03T19:00:00.000Z", endedAt: "2026-11-06T18:30:41.000Z", finished: "2026-11-06T18:30:41.000Z",
        durationSec: 257441, pausedTotalSec: 600, exercises: {},
      },
      paused: {
        id: "paused", programDay: "Friday", status: "saved",
        startedAt: "2026-10-30T18:00:00.000Z", endedAt: "2026-10-30T19:00:00.000Z",
        durationSec: 3600, pausedTotalSec: 900, exercises: {},
      },
    },
  };
  const out = app.migrateDb(app.migrateDb(input));
  assert.equal(out.sessions.nov3.durationSec, 257441);
  assert.equal(out.sessions.paused.durationSec, 3600);
  assert.equal(out.sessions.nov3.durationEstimated, undefined);
  assert.equal(app.sessionDurationSec(out.sessions.nov3), 257441, "export/display use the stored value");
  assert.equal(app.sessionDurationSec(out.sessions.paused), 3600);
});
