import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} should be present`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const validator = vm.runInNewContext(`(${extractFunction(html, "validateManualWorkoutImport")})`);
const importSource = extractFunction(html, "importManualWorkout");
const importWorkout = vm.runInNewContext(`(${importSource})`, {
  PROGRAM: { Monday: { exercises: [] }, Friday: { exercises: [] }, Saturday: { exercises: [] } },
  manualImportKey: payload => JSON.stringify(payload),
  cloneValue: value => JSON.parse(JSON.stringify(value)),
  planForDay: () => null,
  normalizeManualSet: () => ({}),
  numericOrNull: value => value == null ? null : Number(value),
  localTimezone: () => "America/New_York",
  completeStats: () => {},
  db: { sessions: {} },
  save: () => {}
});

test("minimal Monday payload imports successfully", () => {
  const payload = {
    programDay: "Monday",
    performedDate: "2026-09-08",
    exercises: []
  };
  const result = importWorkout(payload);
  assert.equal(result.duplicate, false);
  assert.equal(result.session.programDay, "Monday");
  assert.equal(result.session.performedDate, "2026-09-08");
  assert.equal(result.session.status, "saved");
});

test("validator accepts only the three programmed lifting days", () => {
  for (const programDay of ["Monday", "Friday", "Saturday"]) {
    assert.deepEqual(validator({ programDay, performedDate: "2026-09-08" }), {
      programDay,
      performedDate: "2026-09-08"
    });
  }
});

test("Tuesday is rejected with a specific programDay error", () => {
  assert.throws(
    () => validator({ programDay: "Tuesday", performedDate: "2026-09-08" }),
    /Invalid programDay/
  );
});

test("US-style date is rejected with a specific format error", () => {
  assert.throws(
    () => validator({ programDay: "Monday", performedDate: "09\/08\/2026" }),
    /Invalid performedDate: expected YYYY-MM-DD/
  );
});

test("malformed calendar dates are rejected", () => {
  assert.throws(
    () => validator({ programDay: "Monday", performedDate: "2026-02-30" }),
    /Invalid performedDate: not a real calendar date/
  );
  assert.throws(
    () => validator({ programDay: "Monday", performedDate: "2026-13-01" }),
    /Invalid performedDate: not a real calendar date/
  );
});

test("missing required fields are rejected specifically", () => {
  assert.throws(
    () => validator({ performedDate: "2026-09-08" }),
    /Invalid programDay/
  );
  assert.throws(
    () => validator({ programDay: "Monday" }),
    /Invalid performedDate/
  );
});
