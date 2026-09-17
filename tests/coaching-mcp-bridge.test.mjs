import test from "node:test";
import assert from "node:assert/strict";
import {
  makeCursor,
  normalizeProgramState,
  normalizeWorkout,
  parseISODate,
  parseLimit,
  parseMaxContextDays,
  parseSinceTimestamp,
  sanitizeCanonicalRow
} from "../supabase/functions/coaching-mcp/bridge.mjs";

test("coaching MCP bounds and date parsing are strict", () => {
  assert.equal(parseLimit(1), 1);
  assert.equal(parseLimit(100), 100);
  assert.throws(() => parseLimit(0), /between 1 and 100/);
  assert.equal(parseISODate("2026-02-28"), "2026-02-28");
  assert.throws(() => parseISODate("2026-02-29"), /real calendar date/);
  assert.throws(() => parseISODate("09/08/2026"), /YYYY-MM-DD/);
  assert.match(parseSinceTimestamp("2026-09-17T12:00:00-04:00"), /^2026-09-17T16:00:00/);
  assert.throws(() => parseSinceTimestamp("2026-09-17"), /ISO timestamp/);
  assert.throws(() => parseMaxContextDays("2024-01-01", "2025-01-01"), /366 days/);
});

test("workout normalization keeps program snapshots, warmups, working sets and redacts unsafe fields", () => {
  const row = sanitizeCanonicalRow({
    record_type: "workout_session",
    source_record_id: "session-1",
    occurred_on: "2026-09-17",
    updated_at: "2026-09-17T16:00:00Z",
    payload: {
      id: "session-1",
      programDay: "Monday",
      status: "saved",
      programSnapshot: { title: "Monday", exercises: [{ name: "Squat", sets: 3, min: 5, max: 8, rest: 150 }] },
      exercises: [{
        name: "Squat",
        warmups: [{ type: "warmup", weight: 45, reps: 8, effort: "Easy" }],
        workingSets: [{ weight: 205, reps: 6, effort: "Good", rir: 2, note: "solid" }],
        exerciseNote: "braced",
        photos: ["private-url"]
      }],
      access_token: "must-not-leak",
      pendingPackages: [{ huge: true }]
    }
  });
  assert.equal(row.recordType, "workout_session");
  assert.equal(row.data.exercises[0].warmups[0].type, "warmup");
  assert.equal(row.data.exercises[0].workingSets[0].effort, "Good");
  assert.equal(row.data.exercises[0].workingSets[0].rir, 2);
  assert.equal(row.data.exercises[0].photos, undefined);
  assert.equal(row.data.access_token, undefined);
  assert.equal(row.data.pendingPackages, undefined);
  assert.equal(row.data.programSnapshot.exercises[0].name, "Squat");
});

test("deleted and unknown records are not visible", () => {
  assert.equal(sanitizeCanonicalRow({ record_type: "progress_photo", source_record_id: "p", payload: {} }), null);
  assert.equal(sanitizeCanonicalRow({ record_type: "workout_session", source_record_id: "gone", payload: { __deleted: true } }), null);
});

test("program_state normalizes a full weekly program without mutating historical snapshots", () => {
  const state = normalizeProgramState({
    schemaVersion: 1,
    source: "app",
    currentProgram: {
      Monday: { title: "Monday", exercises: [{ name: "Squat", sets: 3, min: 5, max: 8, rest: 150 }] },
      Saturday: { title: "Saturday", exercises: [{ name: "Dead Hang", sets: 2, min: 20, max: 45, unit: "sec" }] }
    }
  });
  assert.equal(state.currentProgram.Monday.exercises[0].name, "Squat");
  assert.equal(state.currentProgram.Saturday.exercises[0].unit, "sec");
  const snapshot = normalizeWorkout({
    programSnapshot: { title: "Old Monday", exercises: [{ name: "Squat", sets: 3 }] },
    exercises: []
  });
  assert.equal(snapshot.programSnapshot.title, "Old Monday");
});

test("incremental cursor round-trips", () => {
  const cursor = makeCursor("2026-09-17T12:00:00Z", "session-1");
  const row = sanitizeCanonicalRow({
    record_type: "workout_session",
    source_record_id: "session-1",
    updated_at: "2026-09-17T12:00:00Z",
    payload: { status: "saved", exercises: [] }
  });
  assert.equal(row.sourceRecordId, "session-1");
  assert.ok(cursor.length > 10);
});
