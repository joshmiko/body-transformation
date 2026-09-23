import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const validationStart = html.indexOf("const COACH_PROGRAM_STRING_FIELDS");
const validationEnd = html.indexOf("function validateCoachProgram", validationStart);
const applyStart = html.indexOf("function coachRequestWeightEntries");
const applyEnd = html.indexOf("function applyCoachRequestLocally", applyStart);
assert.ok(validationStart >= 0 && validationEnd > validationStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart);
const context = { db: { checkins: [] }, cloneValue: value => JSON.parse(JSON.stringify(value)) };
vm.createContext(context);
vm.runInContext(html.slice(validationStart, validationEnd) + html.slice(applyStart, applyEnd), context);

test("coach weigh-ins apply once and exact retries are idempotent", () => {
  const row = { id: "request-1", weightEntries: [
    { date: "2026-09-20", weightLb: 205, note: "" },
    { date: "2026-09-21", weightLb: 204.5, note: "Morning" }
  ] };
  const first = context.applyCoachWeightEntries(row);
  assert.equal(first.added, 2);
  assert.equal(context.db.checkins.length, 2);
  const second = context.applyCoachWeightEntries(row);
  assert.equal(second.added, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(context.db.checkins.length, 2);
});

test("different same-date weigh-in is blocked without altering history", () => {
  context.db.checkins = [{ id: "real", date: "2026-09-22", weight: 203.5 }];
  assert.throws(
    () => context.applyCoachWeightEntries({ id: "request-2", weightEntries: [{ date: "2026-09-22", weightLb: 202 }] }),
    /Weight conflict.*2026-09-22/
  );
  assert.deepEqual(context.db.checkins, [{ id: "real", date: "2026-09-22", weight: 203.5 }]);
});
