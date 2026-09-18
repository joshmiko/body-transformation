import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@^2.0.0";
import { pipeline } from "npm:@supabase/middleware@^0.5.0";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@^1.6.0";
import { z } from "npm:zod@^4.3.6";
import {
  COACHING_RECORD_TYPES,
  TOOL_LIMITS,
  makeCursor,
  normalizeWorkout,
  parseCursor,
  parseISODate,
  parseLimit,
  parseMaxContextDays,
  parseSinceTimestamp,
  sanitizeCanonicalRow
} from "./bridge.mjs";

const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false
});

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(message) {
  throw new Error(message);
}

async function rowsFor(supabase, { types, limit, since, until, updatedAfter } = {}) {
  let query = supabase
    .from("user_data_records")
    .select("record_type,source_record_id,payload,occurred_on,updated_at")
    .in("record_type", types || COACHING_RECORD_TYPES)
    .order("updated_at", { ascending: true })
    .limit(limit || TOOL_LIMITS.maxRows);
  if (since) query = query.gte("occurred_on", since);
  if (until) query = query.lte("occurred_on", until);
  if (updatedAfter) query = query.gt("updated_at", updatedAfter);
  const { data, error } = await query;
  if (error) fail("Unable to read coaching data: " + error.message);
  return Array.isArray(data) ? data : [];
}

function visible(rows) {
  return rows.map(sanitizeCanonicalRow).filter(Boolean);
}

function isCompletedWorkout(item) {
  const status = String(item?.data?.status || "").toLowerCase();
  return !status || ["saved", "completed", "complete", "finished"].includes(status);
}

function currentProgramFrom(records) {
  const states = records.filter(item => item.recordType === "program_state");
  states.sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
  const latest = states[0]?.data;
  return latest?.currentProgram || latest?.nextWeekProgram || null;
}

function registerTools(server, supabase) {
  server.registerTool(
    "list_recent_workouts",
    {
      description: "List the signed-in user's recent completed workouts. Results are bounded and read-only.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(TOOL_LIMITS.maxLimit).default(20),
        since: z.string().optional()
      }),
      annotations: READ_ONLY
    },
    async ({ limit = 20, since }) => {
      const bounded = parseLimit(limit);
      const start = since ? parseISODate(since, "since") : undefined;
      const rows = await rowsFor(supabase, {
        types: ["workout_session"],
        limit: bounded,
        since: start
      });
      const workouts = visible(rows).filter(isCompletedWorkout).map(item => item.data);
      return result({ workouts, count: workouts.length, limit: bounded });
    }
  );

  server.registerTool(
    "get_workout",
    {
      description: "Read one signed-in user's normalized workout, including warm-ups and working sets.",
      inputSchema: z.object({ workoutId: z.string().min(1).max(120) }),
      annotations: READ_ONLY
    },
    async ({ workoutId }) => {
      const id = String(workoutId).trim();
      const { data, error } = await supabase
        .from("user_data_records")
        .select("record_type,source_record_id,payload,occurred_on,updated_at")
        .eq("record_type", "workout_session")
        .eq("source_record_id", id)
        .maybeSingle();
      if (error) fail("Unable to read workout: " + error.message);
      const item = sanitizeCanonicalRow(data);
      if (!item || !isCompletedWorkout(item)) return result({ workout: null, found: false });
      const workout = normalizeWorkout(item.data) || item.data;
      return result({ workout, found: true });
    }
  );

  server.registerTool(
    "get_coaching_context",
    {
      description: "Read a bounded coaching context for the signed-in user: workouts, check-ins, nutrition, recovery, and current program.",
      inputSchema: z.object({
        since: z.string(),
        until: z.string().optional(),
        maxRecords: z.number().int().min(1).max(TOOL_LIMITS.maxRows).default(50)
      }),
      annotations: READ_ONLY
    },
    async ({ since, until, maxRecords = 50 }) => {
      const period = parseMaxContextDays(since, until);
      const limit = parseLimit(maxRecords, 50);
      const datedRows = await rowsFor(supabase, {
        types: ["workout_session", "checkin", "nutrition_entry", "nutrition_summary", "recovery_activity"],
        limit,
        since: period.since,
        until: period.until
      });
      // Targets, program state, and reviewed coaching watermark are current-state records
      // without an occurred_on date, so read them separately without the date predicate.
      const currentRows = await rowsFor(supabase, {
        types: ["nutrition_target", "program_state", "coaching_state"],
        limit
      });
      const records = visible([...datedRows, ...currentRows]);
      const workouts = records.filter(item => item.recordType === "workout_session" && isCompletedWorkout(item)).map(item => item.data);
      const checkins = records.filter(item => item.recordType === "checkin").map(item => item.data);
      const nutritionEntries = records.filter(item => item.recordType === "nutrition_entry").map(item => item.data);
      const nutritionSummaries = records.filter(item => item.recordType === "nutrition_summary").map(item => item.data);
      const targetRows = records.filter(item => item.recordType === "nutrition_target");
      const recoveryActivities = records.filter(item => item.recordType === "recovery_activity").map(item => item.data);
      const state = records.filter(item => item.recordType === "coaching_state").map(item => item.data).at(-1) || null;
      return result({
        period,
        workouts,
        checkins,
        nutritionEntries,
        nutritionSummaries,
        nutritionTarget: targetRows.at(-1)?.data || null,
        recoveryActivities,
        currentProgram: currentProgramFrom(records),
        coachingState: state,
        updatedAt: records.map(item => item.updatedAt).filter(Boolean).sort().at(-1) || null
      });
    }
  );

  server.registerTool(
    "get_changes_since",
    {
      description: "Read bounded, user-scoped canonical changes after an ISO timestamp. Use the returned cursor for the next page.",
      inputSchema: z.object({
        since: z.string(),
        limit: z.number().int().min(1).max(TOOL_LIMITS.maxLimit).default(50),
        cursor: z.string().optional()
      }),
      annotations: READ_ONLY
    },
    async ({ since, limit = 50, cursor }) => {
      const base = parseSinceTimestamp(since, "since");
      const page = parseLimit(limit, 50);
      const parsedCursor = parseCursor(cursor);
      const rows = await rowsFor(supabase, {
        types: COACHING_RECORD_TYPES,
        limit: page,
        updatedAfter: parsedCursor?.updatedAt || base
      });
      const changes = visible(rows);
      const hasMore = rows.length >= page;
      const last = changes.at(-1);
      return result({
        changes,
        count: changes.length,
        hasMore,
        nextCursor: hasMore && last ? makeCursor(last.updatedAt || base, last.sourceRecordId) : null
      });
    }
  );
}

const handler = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
  async (request, { supabase }) => {
    const mcpHandler = createMcpHandler(() => {
      const server = new McpServer({
        name: "body-transformation-coaching",
        version: "0.1.0"
      });
      registerTools(server, supabase);
      return server;
    });
    return mcpHandler.fetch(request);
  }
);

Deno.serve(handler);
