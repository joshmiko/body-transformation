// Runs the real coaching-mcp tool handlers from index.ts against a fake database that
// holds every record type, including nutrition, and checks no read tool returns nutrition.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bridge from "../supabase/functions/coaching-mcp/bridge.mjs";
import * as writeBridge from "../supabase/functions/coaching-mcp/write-bridge.mjs";

const source = readFileSync(new URL("../supabase/functions/coaching-mcp/index.ts", import.meta.url), "utf8");
const body = source.slice(source.indexOf("const READ_ONLY"), source.indexOf("const handler = pipeline("));
const NUTRITION_TYPES = ["nutrition_entry", "nutrition_summary", "nutrition_target"];

// zod is only used to describe input schemas here; any chain of calls is accepted.
const zShim = new Proxy(function () {}, { get: () => zShim, apply: () => zShim });

const rows = [
  { record_type: "workout_session", source_record_id: "w1", occurred_on: "2026-11-10", updated_at: "2026-11-10T19:00:00Z", payload: { id: "w1", status: "saved", programDay: "Monday", performedDate: "2026-11-10", exercises: {} } },
  { record_type: "checkin", source_record_id: "c1", occurred_on: "2026-11-11", updated_at: "2026-11-11T07:00:00Z", payload: { id: "c1", date: "2026-11-11", weight: 190, proteinTargetDays: 5, calorieTargetDays: 4, averageSteps: 9000 } },
  { record_type: "recovery_activity", source_record_id: "r1", occurred_on: "2026-11-12", updated_at: "2026-11-12T07:00:00Z", payload: { id: "r1", programDay: "Tuesday", performedDate: "2026-11-12", completed: true } },
  { record_type: "program_state", source_record_id: "current", occurred_on: null, updated_at: "2026-11-09T07:00:00Z", payload: { revision: 3, currentProgram: { Monday: { title: "Workout A", exercises: [] } }, plannedEvents: [{ id: "g1", type: "hockey", title: "Game", date: "2026-11-15", startTime: "19:30" }] } },
  { record_type: "coaching_state", source_record_id: "state", occurred_on: null, updated_at: "2026-11-09T07:00:00Z", payload: { reviewedWatermark: "2026-11-08T00:00:00Z", targetGuidance: { calories: 2400, protein: 200 } } },
  { record_type: "nutrition_entry", source_record_id: "n1", occurred_on: "2026-11-11", updated_at: "2026-11-11T12:00:00Z", payload: { id: "n1", date: "2026-11-11", name: "Bowl", calories: 546, protein: 61 } },
  { record_type: "nutrition_summary", source_record_id: "s1", occurred_on: "2026-11-11", updated_at: "2026-11-11T22:00:00Z", payload: { id: "s1", date: "2026-11-11", calories: 2300, protein: 190 } },
  { record_type: "nutrition_target", source_record_id: "default", occurred_on: null, updated_at: "2026-11-01T07:00:00Z", payload: { calories: 2350, protein: 200 } }
];

// honorTypeFilter=false simulates a query that ignores the record_type filter, to prove the
// bridge's own allow-list still drops nutrition rows.
function fakeSupabase({ honorTypeFilter }) {
  const requestedTypes = [];
  const from = () => {
    const filters = { types: null, eq: {} };
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder, gte: () => builder, lte: () => builder, gt: () => builder,
      in: (column, values) => { requestedTypes.push(...values); filters.types = values; return builder; },
      eq: (column, value) => { filters.eq[column] = value; return builder; },
      run() {
        return rows.filter(row => (!honorTypeFilter || !filters.types || filters.types.includes(row.record_type)) &&
          Object.entries(filters.eq).every(([column, value]) => column === "record_type" && !honorTypeFilter ? true : row[column] === value));
      },
      maybeSingle: async () => ({ data: builder.run()[0] || null, error: null }),
      single: async () => ({ data: builder.run()[0] || null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: builder.run(), error: null }).then(resolve, reject)
    };
    return builder;
  };
  return { client: { from }, requestedTypes };
}

function loadTools(supabase) {
  const tools = {};
  const server = { registerTool: (name, config, handler) => { tools[name] = { config, handler }; } };
  const factory = new Function("z", "bridge", "writeBridge", `
    const { COACHING_RECORD_TYPES, TOOL_LIMITS, makeCursor, normalizeWorkout, parseCursor, parseISODate, parseLimit, parseMaxContextDays, parseSinceTimestamp, sanitizeCanonicalRow } = bridge;
    const { COACH_UPDATE_SCHEMA, isDefinitelyPastProgramEffectiveDate, normalizeExpectedWatermark, payloadHash, validateCoachUpdate } = writeBridge;
    ${body}
    return registerTools;`);
  factory(zShim, bridge, writeBridge)(server, supabase, {});
  return tools;
}

const readCalls = {
  list_recent_workouts: { limit: 20 },
  get_workout: { workoutId: "w1" },
  get_coaching_context: { since: "2026-11-01", until: "2026-11-14", maxRecords: 50 },
  get_changes_since: { since: "2026-11-01T00:00:00Z", limit: 50 }
};
const parse = output => JSON.parse(output.content[0].text);
const NUTRITION_TEXT = /nutrition|calorie|protein|"carbs"|"fat"/i;

for (const honorTypeFilter of [true, false]) {
  test(`no read tool returns nutrition (${honorTypeFilter ? "normal query" : "query ignores the type filter"})`, async () => {
    const { client, requestedTypes } = fakeSupabase({ honorTypeFilter });
    const tools = loadTools(client);
    for (const [name, args] of Object.entries(readCalls)) {
      assert.ok(tools[name], name + " is registered");
      const output = parse(await tools[name].handler(args));
      const text = JSON.stringify(output);
      assert.doesNotMatch(text, NUTRITION_TEXT, name + " returned nutrition: " + text.slice(0, 300));
      for (const type of NUTRITION_TYPES) assert.ok(!text.includes(type), name + " returned " + type);
    }
    for (const type of NUTRITION_TYPES) assert.ok(!requestedTypes.includes(type), "a read tool asked the database for " + type);
  });
}

test("read tools still return workouts, check-ins, recovery, program and plannedEvents", async () => {
  const tools = loadTools(fakeSupabase({ honorTypeFilter: true }).client);
  const context = parse(await tools.get_coaching_context.handler(readCalls.get_coaching_context));
  assert.equal(context.workouts.length, 1);
  assert.equal(context.checkins[0].weight, 190);
  assert.equal(context.checkins[0].averageSteps, 9000);
  assert.equal(context.recoveryActivities.length, 1);
  assert.ok(context.currentProgram.Monday);
  assert.equal(context.plannedEvents[0].id, "g1");
  assert.equal(context.coachingState.reviewedWatermark, "2026-11-08T00:00:00.000Z");
  for (const key of ["nutritionEntries", "nutritionSummaries", "nutritionTarget"]) assert.ok(!(key in context), key);

  const changes = parse(await tools.get_changes_since.handler(readCalls.get_changes_since));
  assert.deepEqual([...new Set(changes.changes.map(item => item.recordType))].sort(), ["checkin", "coaching_state", "program_state", "recovery_activity", "workout_session"]);
  assert.equal(parse(await tools.list_recent_workouts.handler(readCalls.list_recent_workouts)).count, 1);
  assert.equal(parse(await tools.get_workout.handler(readCalls.get_workout)).found, true);
  assert.ok(tools.create_coach_update_draft && tools.submit_coach_update, "plan tools are still registered");
});

test("the bridge allow-list excludes nutrition and the tool descriptions say so", () => {
  for (const type of NUTRITION_TYPES) {
    assert.ok(!bridge.COACHING_RECORD_TYPES.includes(type), type);
    assert.equal(bridge.sanitizeCanonicalRow(rows.find(row => row.record_type === type)), null, type);
  }
  const tools = loadTools(fakeSupabase({ honorTypeFilter: true }).client);
  assert.match(tools.get_coaching_context.config.description, /Nutrition is not included/);
  assert.match(tools.get_changes_since.config.description, /Nutrition records are never returned/);
  assert.match(tools.create_coach_update_draft.config.description, /targetGuidance[^.]*not used for nutrition/);
  assert.match(source, /targetGuidance: z\.unknown\(\)\.optional\(\)\.describe\("[^"]*Not used for nutrition/);
});
