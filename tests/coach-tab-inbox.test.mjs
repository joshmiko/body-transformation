import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Coach tab leads to the review inbox and keeps manual fallback out of the tab", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const start = index.indexOf("function coach(){");
  const end = index.indexOf("\nlet btRestTimer", start);
  assert.ok(start >= 0 && end > start);
  const coach = index.slice(start, end);
  assert.match(coach, /COACH UPDATES/);
  assert.match(coach, /id="coach-inbox-card"/);
  assert.match(coach, /loadCoachInbox\(\)/);
  assert.doesNotMatch(coach, /manual ChatGPT handoff|Create coaching update/);
  assert.match(index, /Advanced \/ backup coaching/);
  assert.match(index, /onclick="sync\(\)"/);
});
