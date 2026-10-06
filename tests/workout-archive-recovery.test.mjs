import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("a rejected local save leaves a reviewed workout open and offers export recovery", () => {
  const source = indexHtml.match(/function saveReviewedWorkout\(d\)\{[\s\S]*?\}(?=\s*function finish\()/)?.[0];
  assert.ok(source, "reviewed workout save handler should exist");
  const session = { id: "session-1", sessionId: "session-1", status: "review", sessionNote: "before" };
  const db = { sessions: { "session-1": session }, activeSessionId: "session-1", activeProgramDay: "Monday", currentExerciseIndex: 2, currentSetIndex: 1 };
  const elements = {
    "session-note": { value: "kept in memory" },
    "review-overall-feel": { value: "Hard" }
  };
  const persistSource = indexHtml.match(/function persistLocalDb\(\)\{[\s\S]*?\}(?=\s*const save=)/)?.[0];
  assert.ok(persistSource, "local persistence handler should exist");
  const persist = new Function("btWriteDbForAccount", "db", `let btLocalWriteError=null; ${persistSource}; return { persistLocalDb, getError:()=>btLocalWriteError }`)(
    () => { throw new DOMException("quota exceeded", "QuotaExceededError"); },
    db
  );
  const calls = { failure: 0, rendered: 0 };
  const handler = new Function(
    "getSession", "cloneValue", "db", "clearActiveSessionPointer", "save", "document",
    "derivedDurationSec", "completeStats", "showWorkoutSaveFailure", "renderSavedWorkout",
    `return (${source})`
  )(
    () => session,
    value => JSON.parse(JSON.stringify(value)),
    db,
    () => { delete db.activeSessionId; delete db.activeProgramDay; delete db.currentExerciseIndex; delete db.currentSetIndex; },
    () => persist.persistLocalDb(),
    { getElementById: id => elements[id] || null },
    () => 60,
    () => {},
    () => { calls.failure++; },
    () => { calls.rendered++; }
  );

  handler("Monday");
  assert.equal(db.sessions["session-1"].status, "review");
  assert.equal(db.sessions["session-1"].sessionNote, "kept in memory");
  assert.equal(db.sessions["session-1"].overallFeel, "Hard");
  assert.equal(db.activeSessionId, "session-1");
  assert.equal(db.currentExerciseIndex, 2);
  assert.equal(calls.failure, 1);
  assert.equal(calls.rendered, 0);
  assert.equal(persist.getError().code, "LOCAL_PERSIST_FAILED");
  assert.equal(persist.getError().cause.name, "QuotaExceededError");
  assert.equal(new DOMException("quota exceeded", "QuotaExceededError").code, 22, "native error code remains numeric/read-only");
  assert.match(indexHtml, /review-save-workout/);
  assert.match(indexHtml, /function showWorkoutSaveFailure[\s\S]*data-workout-export/);
});

test("archive is compact, retains completed records, and shows the pending count", () => {
  const source = indexHtml.match(/function workoutArchiveMarkup\(\)\{[\s\S]*?\}(?=\s*function exportWorkoutBackup\()/)?.[0];
  assert.ok(source, "archive renderer should exist");
  const db = { sessions: {
    saved: { id: "saved", status: "saved", performedDate: "2026-10-01" },
    legacy: { id: "legacy", status: "completed", performedDate: "2026-09-30" },
    review: { id: "review", status: "review", endedAt: "2026-10-02" },
    warmup: { id: "warmup", status: "saved", performedDate: "2026-10-01", isWarmup: true }
  } };
  const render = new Function("db", "isStandaloneWarmupSession", "sessionChronologyDate", "workoutSyncLabel", "progressWorkoutSummary", "workoutRecoveryMarkup", `return (${source})`)(
    db,
    session => !!session.isWarmup,
    session => session.performedDate || "",
    session => ({ state: session.id === "saved" ? "synced" : "pending" }),
    session => `<article>${session.id}</article>`,
    session => `<div data-workout-sync="${session.id}" data-workout-retry="${session.id}" data-workout-export="${session.id}"></div>`
  );
  const markup = render();
  assert.match(markup, /<details class="card workout-archive">/);
  assert.match(markup, /Workout archive \(2\).*1 waiting to sync/);
  assert.match(markup, /<article>saved<\/article>/);
  assert.match(markup, /<article>legacy<\/article>/);
  assert.doesNotMatch(markup, /<article>review<\/article>|<article>warmup<\/article>/);
  assert.match(markup, /data-workout-sync="legacy"/);
  assert.match(markup, /data-workout-retry="legacy"/);
  assert.match(markup, /data-workout-export="legacy"/);
});
