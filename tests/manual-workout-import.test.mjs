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

const scheduled = (day, date) => (date === "2026-09-07" && day === "Monday") || (date === "2026-09-08" && day === "Tuesday") || (date === "2026-09-11" && day === "Friday") || (date === "2026-09-12" && day === "Saturday");
const planForDay = (day, date) => scheduled(day, date) ? { title: `${day} lift`, exercises: [] } : null;
const validationPlanForDay = (day, date) => scheduled(day, date) ? { exercises: [{ name: "Squat" }] } : null;
const validator = vm.runInNewContext(`(${extractFunction(html, "validateManualWorkoutImport")})`, { planForDay: validationPlanForDay });
const importSource = extractFunction(html, "importManualWorkout");
const importWorkout = vm.runInNewContext(`(${importSource})`, {
  validateManualWorkoutImport: validator,
  PROGRAM: { Monday: { exercises: [] }, Friday: { exercises: [] }, Saturday: { exercises: [] } },
  manualImportKey: payload => JSON.stringify(payload),
  cloneValue: value => JSON.parse(JSON.stringify(value)),
  planForDay,
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
    performedDate: "2026-09-07",
    exercises: []
  };
  const result = importWorkout(payload);
  assert.equal(result.duplicate, false);
  assert.equal(result.session.programDay, "Monday");
  assert.equal(result.session.performedDate, "2026-09-07");
  assert.equal(result.session.status, "saved");
});

test("validator accepts lifting on the dates prescribed for a flexible week", () => {
  for (const [programDay, performedDate] of [["Monday", "2026-09-07"], ["Tuesday", "2026-09-08"], ["Friday", "2026-09-11"], ["Saturday", "2026-09-12"]]) {
    const result = validator({ programDay, performedDate });
    assert.equal(result.programDay, programDay);
    assert.equal(result.performedDate, performedDate);
  }
});

test("a recovery day is rejected even when the weekday name is valid", () => {
  assert.throws(
    () => validator({ programDay: "Wednesday", performedDate: "2026-09-09" }),
    /No lifting workout was scheduled/
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
