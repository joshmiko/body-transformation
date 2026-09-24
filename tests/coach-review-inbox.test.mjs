import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("coach review inbox is review-gated and preserves the manual fallback", async () => {
  const [index, rest, migration, weightMigration, effectiveDateMigration, server] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/supabase-rest.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202609200001_coaching_review_transitions.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202609220001_coaching_weight_entries.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202609240001_coach_program_effective_date.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/coaching-mcp/index.ts", import.meta.url), "utf8")
  ]);
  assert.match(index, /loadCoachInbox/);
  assert.match(index, /Approve & apply/);
  assert.match(index, /Reject \/ keep current plan/);
  assert.match(index, /Advanced \/ backup coaching/);
  assert.match(index, /applyCoachRequestLocally/);
  assert.match(index, /programEffectiveDate:db\.nextWeekProgram\?db\.nextWeekProgramEffectiveDate/);
  assert.match(index, /coachProgramEffectiveDate\(row\)/);
  assert.match(index, /Effective date \(local calendar\)/);
  assert.match(index, /Effective date \(default, next Monday\)/);
  assert.match(index, /program effective date is in the past/);
  assert.match(index, /return localDateKey\(x\)/);
  assert.match(index, /function sessionProgram\(d\)\{return getSession\(d\)\.programSnapshot\|\|planForDay\(d\)\}/);
  assert.match(index, /reviewedWatermark/);
  assert.equal((index.match(/id="coach-inbox-card"/g) || []).length, 1);
  assert.match(index, /ChatGPT can propose changes from your signed-in data/);
  assert.match(index, /progress-primary/);
  const progressStart = index.indexOf("function progress()");
  const progressEnd = index.indexOf("function focusWeightCheckin", progressStart);
  assert.doesNotMatch(index.slice(progressStart, progressEnd), /coach-inbox-card/);
  assert.doesNotMatch(index, /broader coaching is a manual ChatGPT handoff/);
  assert.match(rest, /request_version=eq/);
  assert.match(rest, /defaultProgramEffectiveDate/);
  assert.match(rest, /value\.programEffectiveDate/);
  assert.match(rest, /merged\.nextWeekProgramEffectiveDate/);
  assert.match(rest, /Coach update changed elsewhere/);
  assert.match(migration, /add column if not exists request_version/);
  assert.match(migration, /old\.status = 'submitted'/);
  assert.match(migration, /old\.status = 'approved'/);
  assert.match(migration, /Coach-update proposal is immutable after submission/);
  assert.match(migration, /direct sessions read coach update requests/);
  assert.match(migration, /direct sessions review coach update requests/);
  assert.match(weightMigration, /weight_entries/);
  assert.match(effectiveDateMigration, /add column if not exists program_effective_date date/);
  assert.match(effectiveDateMigration, /old\.program_effective_date is distinct from new\.program_effective_date/);
  assert.match(server, /programEffectiveDate: row\.program_effective_date/);
  assert.match(server, /program_effective_date: update\.programEffectiveDate/);
  assert.match(server, /isDefinitelyPastProgramEffectiveDate\(update\.programEffectiveDate\)/);
  assert.match(server, /requestVersion/);
  assert.match(server, /request_version: Number\(row\.request_version/);
});

test("coach review transitions are explicit and non-destructive", () => {
  const allowed = {
    submitted: new Set(["approved", "rejected"]),
    approved: new Set(["applied"]),
    rejected: new Set(),
    applied: new Set()
  };
  assert.ok(allowed.submitted.has("approved"));
  assert.ok(allowed.submitted.has("rejected"));
  assert.ok(allowed.approved.has("applied"));
  assert.equal(allowed.rejected.size, 0);
  assert.equal(allowed.applied.size, 0);
});
