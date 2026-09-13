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

const parseDateValue = value => {
  const raw = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + "T12:00:00Z") : new Date(raw);
};
const localDateKey = date => date.toISOString().slice(0, 10);
const sessionPerformedDate = vm.runInNewContext(`(${extractFunction(html, "sessionPerformedDate")})`, { parseDateValue, localDateKey });
const sessionChronologyDate = vm.runInNewContext(
  `(${extractFunction(html, "sessionChronologyDate")})`,
  { sessionPerformedDate }
);
const weekStart = value => {
  const raw = String(value || "");
  const d = /^\\d{4}-\\d{2}-\\d{2}$/.test(raw)
    ? new Date(raw + "T12:00:00Z")
    : new Date(raw);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
};
const progressWeekKey = vm.runInNewContext(
  `(${extractFunction(html, "progressWeekKey")})`,
  { weekStart }
);

test("historical manual imports group by performedDate, not later import time", () => {
  const importedLater = {
    programDay: "Monday",
    performedDate: "2026-08-31",
    finished: "2026-09-12T15:00:00.000Z",
    endedAt: null,
    status: "saved"
  };
  const canonicalDate = sessionChronologyDate(importedLater);
  assert.equal(canonicalDate, "2026-08-31");
  assert.equal(progressWeekKey(canonicalDate), "2026-08-31");
  assert.equal(progressWeekKey(importedLater.finished), "2026-09-07");
  assert.notEqual(progressWeekKey(canonicalDate), progressWeekKey(importedLater.finished));
  assert.match(html, /_progressDate:sessionChronologyDate\(s\)/);
  assert.match(html, /groups\[key\(s\._progressDate\)\]/);
  assert.match(html, /dateLabel\(sessionChronologyDate\(s\)/);
});

test("legacy sessions fall back to finished only when performedDate/date is unavailable", () => {
  const legacy = { finished: "2026-09-12T15:00:00.000Z" };
  assert.equal(sessionChronologyDate(legacy), "2026-09-12");
  const performedWins = {
    performedDate: "2026-08-31",
    finished: "2026-09-12T15:00:00.000Z"
  };
  assert.equal(sessionChronologyDate(performedWins), "2026-08-31");
});
