import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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

test("newer coaching data invalidates an unreviewed pending package", () => {
  let latest = "2026-09-10T12:00:00.000Z";
  const validTimestamp = value => Date.parse(value || "") || null;
  const latestCoachingDataTimestamp = () => latest;
  const isCurrent = vm.runInNewContext(
    `(${extractFunction(html, "pendingCoachingPackageIsCurrent")})`,
    { validTimestamp, latestCoachingDataTimestamp }
  );
  assert.equal(isCurrent({ includedThrough: "2026-09-09T12:00:00.000Z" }), false);
  assert.equal(isCurrent({ includedThrough: "2026-09-10T12:00:00.000Z" }), true);
  latest = null;
  assert.equal(isCurrent({ includedThrough: "2026-09-10T12:00:00.000Z" }), true);
});

test("coaching cutoff remains tied to reviewed watermark", () => {
  assert.match(html, /reviewedWatermark\|\|"1970-01-01T00:00:00.000Z"/);
  assert.match(html, /includedDataCutoff:cutoff/);
  assert.match(html, /reviewed:false/);
  assert.match(html, /await window\.btRehydrateSupabase/);
});
