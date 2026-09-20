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
import {
  COACH_UPDATE_SCHEMA,
  normalizeExpectedWatermark,
  payloadHash,
  validateCoachUpdate
} from "./write-bridge.mjs";

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

const WRITE_DRAFT = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});
const WRITE_SUBMIT = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

function safeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    schema: row.schema,
    sourcePackageId: row.source_package_id,
    expectedWatermark: row.expected_watermark || null,
    coachSummary: row.coach_summary,
    nextWeekProgram: row.next_week_program || null,
    targetGuidance: row.target_guidance || null,
    payloadHash: row.payload_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requestVersion: row.request_version || 1,
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    appliedAt: row.applied_at || null
  };
}

function clientIdFromClaims(jwtClaims) {
  const id = String(jwtClaims?.client_id || "").trim();
  return id || null;
}

function requireOAuthClient(jwtClaims) {
  const clientId = clientIdFromClaims(jwtClaims);
  if (!clientId) fail("OAuth client identity is required for coach-update writes.");
  return clientId;
}

function userIdFromClaims(jwtClaims) {
  const id = String(jwtClaims?.sub || "").trim();
  if (!id) fail("Unable to identify the signed-in user.");
  return id;
}

async function reviewedWatermark(supabase) {
  const { data, error } = await supabase
    .from("user_data_records")
    .select("payload")
    .eq("record_type", "coaching_state")
    .eq("source_record_id", "state")
    .limit(1)
    .maybeSingle();
  if (error) fail("Unable to read coaching watermark: " + error.message);
  const payload = data?.payload;
  return normalizeExpectedWatermark(payload?.reviewedWatermark || payload?.reviewedThrough || null);
}

async function assertWatermark(supabase, expected) {
  if (expected === null || expected === undefined) return;
  const current = await reviewedWatermark(supabase);
  if (current !== expected) {
    fail("COACHING_WATERMARK_CONFLICT expected=" + expected + " current=" + (current || "null"));
  }
}

function validatedUpdate(input) {
  return validateCoachUpdate({
    schema: COACH_UPDATE_SCHEMA,
    sourcePackageId: input.sourcePackageId,
    coachSummary: input.coachSummary,
    nextWeekProgram: input.nextWeekProgram,
    targetGuidance: input.targetGuidance
  });
}

function requestHash(update, expectedWatermark) {
  return payloadHash({ update, expectedWatermark: expectedWatermark || null });
}

async function recordAudit(supabase, row, eventType, clientId) {
  const { error } = await supabase.from("coaching_update_audit").insert({
    request_id: row.id,
    user_id: row.user_id,
    event_type: eventType,
    actor_type: clientId ? "oauth" : "app",
    actor_client_id: clientId || null,
    details: { payloadHash: row.payload_hash, expectedWatermark: row.expected_watermark || null }
  });
  if (error) fail("Coach update was queued but its audit event could not be recorded: " + error.message);
}

async function existingByIdempotency(supabase, userId, idempotencyKey) {
  const { data, error } = await supabase
    .from("coaching_update_requests")
    .select("*")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (error) fail("Unable to check coach-update idempotency: " + error.message);
  return data || null;
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
  server.registerTool(
    "create_coach_update_draft",
    {
      description: "Create an idempotent draft of a reviewed coach update. This never changes workouts, history, canonical program state, nutrition history, or photos. The Body Transformation app must review and apply it.",
      inputSchema: z.object({
        idempotencyKey: z.string().min(8).max(120),
        sourcePackageId: z.string().min(1).max(160),
        coachSummary: z.string().min(1).max(4000),
        nextWeekProgram: z.unknown().optional(),
        targetGuidance: z.unknown().optional(),
        expectedWatermark: z.string().nullable().optional(),
        confirm: z.literal(true)
      }),
      annotations: WRITE_DRAFT
    },
    async (input, context) => {
      const clientId = requireOAuthClient(context.jwtClaims);
      const userId = userIdFromClaims(context.jwtClaims);
      const update = validatedUpdate(input);
      const expectedWatermark = input.expectedWatermark === undefined
        ? null
        : normalizeExpectedWatermark(input.expectedWatermark);
      await assertWatermark(context.supabase, expectedWatermark);
      const hash = requestHash(update, expectedWatermark);
      const existing = await existingByIdempotency(context.supabase, userId, input.idempotencyKey);
      if (existing) {
        if (existing.payload_hash !== hash) fail("IDEMPOTENCY_CONFLICT: idempotencyKey already represents a different coach update.");
        return result({ request: safeRequest(existing), idempotent: true });
      }
      const row = {
        user_id: userId,
        idempotency_key: input.idempotencyKey,
        schema: COACH_UPDATE_SCHEMA,
        source_package_id: update.sourcePackageId,
        expected_watermark: expectedWatermark,
        coach_summary: update.coachSummary,
        next_week_program: update.nextWeekProgram || null,
        target_guidance: update.targetGuidance || null,
        payload_hash: hash,
        status: "draft",
        requested_by_client_id: clientId
      };
      const inserted = await context.supabase
        .from("coaching_update_requests")
        .insert(row)
        .select("*")
        .single();
      if (inserted.error) {
        if (/duplicate|unique/i.test(inserted.error.message || "")) {
          const raced = await existingByIdempotency(context.supabase, userId, input.idempotencyKey);
          if (raced && raced.payload_hash === hash) return result({ request: safeRequest(raced), idempotent: true });
        }
        fail("Unable to queue coach update draft: " + inserted.error.message);
      }
      await recordAudit(context.supabase, inserted.data, "draft_created", clientId);
      return result({ request: safeRequest(inserted.data), idempotent: false });
    }
  );

  server.registerTool(
    "submit_coach_update",
    {
      description: "Submit an existing coach-update draft for explicit in-app review. This never applies a program or changes historical records.",
      inputSchema: z.object({
        requestId: z.string().min(1).max(120),
        expectedWatermark: z.string().nullable().optional(),
        confirm: z.literal(true)
      }),
      annotations: WRITE_SUBMIT
    },
    async (input, context) => {
      const clientId = requireOAuthClient(context.jwtClaims);
      const requestedExpected = input.expectedWatermark === undefined
        ? undefined
        : normalizeExpectedWatermark(input.expectedWatermark);
      const query = context.supabase
        .from("coaching_update_requests")
        .select("*")
        .eq("id", input.requestId)
        .eq("status", "draft")
        .limit(1)
        .maybeSingle();
      const { data: row, error } = await query;
      if (error) fail("Unable to read coach-update draft: " + error.message);
      if (!row) fail("Coach-update draft not found or is no longer editable.");
      const storedExpected = normalizeExpectedWatermark(row.expected_watermark);
      if (requestedExpected !== undefined && requestedExpected !== storedExpected) {
        fail("COACHING_WATERMARK_CONFLICT expected=" + (requestedExpected || "null") + " current=" + (storedExpected || "null"));
      }
      const update = validateCoachUpdate({
        schema: row.schema,
        sourcePackageId: row.source_package_id,
        coachSummary: row.coach_summary,
        nextWeekProgram: row.next_week_program === null ? undefined : row.next_week_program,
        targetGuidance: row.target_guidance === null ? undefined : row.target_guidance
      });
      if (requestHash(update, storedExpected) !== row.payload_hash) fail("Coach-update draft integrity check failed.");
      await assertWatermark(context.supabase, storedExpected);
      const now = new Date().toISOString();
      const updated = await context.supabase
        .from("coaching_update_requests")
        .update({ status: "submitted", submitted_at: now, request_version: Number(row.request_version || 1) + 1 })
        .eq("id", row.id)
        .eq("status", "draft")
        .eq("request_version", Number(row.request_version || 1))
        .select("*")
        .single();
      if (updated.error) fail("Unable to submit coach-update draft: " + updated.error.message);
      await recordAudit(context.supabase, updated.data, "submitted", clientId);
      return result({ request: safeRequest(updated.data), idempotent: false });
    }
  );

}

const handler = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
  async (request, { supabase, jwtClaims }) => {
    const mcpHandler = createMcpHandler(() => {
      const server = new McpServer({
        name: "body-transformation-coaching",
        version: "0.1.0"
      });
      registerTools(server, supabase, jwtClaims);
      return server;
    });
    return mcpHandler.fetch(request);
  }
);

Deno.serve(handler);
