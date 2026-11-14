import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const storage = new Map([
  ["bt_supabase_session", JSON.stringify({ access_token: "test-token", user: { id: "user-1" } })]
]);
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" });
const supabase = await import("../src/supabase-rest.js?nutrition-retired-test");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const line = name => html.match(new RegExp(`^function ${name}\\([^\\n]*$`, "m"))?.[0];

function loadMigrateDb() {
  const start = html.indexOf("function cloneValue(");
  const end = html.indexOf("\n", html.indexOf("function migrateDb("));
  const context = { PROGRAM: {}, progressWeekKey: value => String(value).slice(0, 10) };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return context.migrateDb;
}

// Nutrition as an older phone stored it: ranges, estimates, presets, imports and an extra field.
const legacyNutrition = () => ({
  targets: { calories: { min: 2300, max: 2400, bullseye: 2350 }, protein: 200, carbs: null, fat: null },
  presets: [{ id: "breakfast", name: "Usual breakfast", calories: null, protein: null, carbs: null, fat: null }],
  entries: [
    { id: "nutrition_1", date: "2026-11-01", name: "Yogurt bowl", meal: "Breakfast", calories: 546, protein: 61.5, carbs: 49, fat: 13.5, estimated: false, createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z" },
    { id: "nutrition_2", date: "2026-11-01", name: "Dinner out", calories: { min: 800, max: 1000 }, protein: "60", estimated: true, legacyNote: "kept as-is", createdAt: "2026-11-01T19:00:00.000Z" }
  ],
  dailySummaries: [{ id: "summary_2026-11-02", date: "2026-11-02", calories: 2310, protein: 195, estimated: true, createdAt: "2026-11-03T07:00:00.000Z" }],
  imports: [{ packageId: "nutrition-pkg-1", importedAt: "2026-11-03T07:00:00.000Z", importedEntryCount: 0, importedSummaryCount: 1, skippedDuplicateCount: 0 }]
});

test("an older database with nutrition data loads without changing it", () => {
  const migrateDb = loadMigrateDb();
  const stored = { sessions: {}, checkins: [], nutrition: legacyNutrition() };
  const loaded = migrateDb(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.nutrition)), legacyNutrition());
  const again = migrateDb(JSON.parse(JSON.stringify(loaded)));
  assert.deepEqual(JSON.parse(JSON.stringify(again.nutrition)), legacyNutrition(), "loading twice is stable");

  const odd = migrateDb({ nutrition: "not an object" });
  assert.deepEqual(JSON.parse(JSON.stringify(odd.nutrition)), {}, "a malformed value still loads");
  const fresh = migrateDb({});
  assert.deepEqual(JSON.parse(JSON.stringify(fresh.nutrition)), {}, "a new database gets no nutrition targets or presets");
});

test("nutrition records from the cloud survive reload and sync without being re-sent, rewritten or deleted", async () => {
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_meta_v2", "user-1"));
  storage.delete(supabase.accountScopedStorageKey("bt_supabase_canonical_sync_queue", "user-1"));
  const nutrition = legacyNutrition();
  const cloudRows = [
    ...nutrition.entries.map(entry => ({ record_type: "nutrition_entry", source_record_id: entry.id, payload: entry, updated_at: "2026-11-03T08:00:00.000Z" })),
    ...nutrition.dailySummaries.map(summary => ({ record_type: "nutrition_summary", source_record_id: summary.id, payload: summary, updated_at: "2026-11-03T08:00:00.000Z" })),
    { record_type: "nutrition_target", source_record_id: "default", payload: nutrition.targets, updated_at: "2026-11-03T08:00:00.000Z" }
  ];
  const merged = supabase.mergeCanonicalRecords({ sessions: {}, checkins: [], nutrition: { entries: [], dailySummaries: [] }, recoveryActivities: [] }, cloudRows);

  // Simulate the app persisting and reloading on the new version.
  const reloaded = loadMigrateDb()(JSON.parse(JSON.stringify(merged)));
  reloaded.sessions["new-workout"] = { id: "new-workout", programDay: "Monday", performedDate: "2026-11-14", finished: "2026-11-14T19:00:00.000Z", status: "saved", exercises: {} };
  const before = JSON.parse(JSON.stringify(reloaded.nutrition));

  const uploads = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      const rows = JSON.parse(options.body);
      uploads.push(...rows);
      return { ok: true, status: 200, json: async () => rows, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  const result = await supabase.syncLocalDb(reloaded);
  assert.equal(result.status, "synced");
  assert.ok(uploads.some(row => row.record_type === "workout_session"), "other records still sync");
  const nutritionUploads = uploads.filter(row => row.record_type.startsWith("nutrition"));
  assert.deepEqual(nutritionUploads, [], "unchanged nutrition records are not re-sent");
  assert.ok(!uploads.some(row => row.payload?.__deleted), "nothing is deleted");
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.nutrition)), before, "local nutrition is unchanged by sync");
  for (const row of cloudRows.filter(row => row.record_type === "nutrition_entry")) {
    const local = reloaded.nutrition.entries.find(entry => entry.id === row.source_record_id);
    const { cloudSyncedAt, ...payload } = local;
    assert.deepEqual(payload, row.payload);
  }
});

test("approving a Coach plan with calorie and protein guidance does not touch nutrition", () => {
  const start = html.indexOf("function applyCoachRequestLocally(");
  const end = html.indexOf("async function reviewCoachRequest(", start);
  const state = { appliedRequests: [] };
  const db = { nutrition: { targets: { calories: 2100, protein: 180 } }, checkins: [] };
  const context = {
    db, cloneValue: value => JSON.parse(JSON.stringify(value)), coachSyncState: () => state, save: () => ({ status: "synced" }),
    coachEffectiveDateIssue: () => "", applyCoachWeightEntries: () => ({ added: 0 }), weeklyPrograms: () => [], stageProgramState: () => {},
    coachProgramEffectiveDate: () => "2026-11-16", completeCoachProgram: value => value
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.applyCoachRequestLocally({ id: "plan-1", target_guidance: { calories: { min: 2400, max: 2500 }, protein: 210, stepsAverageTarget: 9000 } });
  assert.deepEqual(JSON.parse(JSON.stringify(db.nutrition)), { targets: { calories: 2100, protein: 180 } });
  assert.equal(state.targetGuidance.stepsAverageTarget, 9000, "non-nutrition guidance is still recorded");
});

test("Coach plan cards hide calorie and protein guidance but keep the rest", () => {
  const context = { escapeHtml: v => String(v ?? "") };
  vm.createContext(context);
  vm.runInContext([line("coachGuidanceValue"), line("coachTargetGuidanceMarkup")].join("\n"), context);
  assert.equal(context.coachTargetGuidanceMarkup({ calories: 2400, protein: 200 }), "");
  const markup = context.coachTargetGuidanceMarkup({ calories: 2400, stepsAverageTarget: 9000 });
  assert.match(markup, /stepsAverageTarget/);
  assert.doesNotMatch(markup, /calories/);
});

test("the app has four tabs and no nutrition screens or numbers", () => {
  const nav = html.match(/<div class="nav">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.deepEqual([...nav.matchAll(/<button id="(\w+)"/g)].map(m => m[1]), ["nToday", "nWorkout", "nProgress", "nCoach"]);
  assert.deepEqual([...nav.matchAll(/<\/span>([^<]+)<\/button>/g)].map(m => m[1]), ["Today", "Workout", "Progress", "Coach"]);
  assert.match(html, /<div class="sub">Train • Recover • Progress<\/div>/);
  for (const removed of ["function nutrition()", "Daily fuel", "Fuel today", "Import from Coach", "pc-protein", "pc-calories", "exportNutrition", "nutritionStore", "defaultNutritionPresets"]) {
    assert.ok(!html.includes(removed), removed);
  }
  const pkg = html.match(/^function buildCoachingPackage\(\)[^\n]*$/m)?.[0] || "";
  assert.ok(pkg && !/nutrition/i.test(pkg), "the Coach package no longer exports nutrition");
});
