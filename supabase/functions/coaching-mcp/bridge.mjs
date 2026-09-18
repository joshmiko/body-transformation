// Pure, dependency-free normalization shared by the read-only coaching MCP server and tests.
// This module deliberately exposes only bounded, user-safe coaching data.

export const COACHING_RECORD_TYPES = Object.freeze([
  "workout_session",
  "checkin",
  "nutrition_entry",
  "nutrition_summary",
  "nutrition_target",
  "recovery_activity",
  "program_state",
  "coaching_state"
]);

export const TOOL_LIMITS = Object.freeze({
  maxLimit: 100,
  maxContextDays: 366,
  maxText: 4000,
  maxExercises: 32,
  maxSets: 24,
  maxRows: 100
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/;

export function parseISODate(value, label = "date") {
  const raw = String(value ?? "").trim();
  if (!DATE_RE.test(raw)) throw new Error(label + " must use YYYY-MM-DD");
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(label + " is not a real calendar date");
  }
  return raw;
}

export function parseSinceTimestamp(value, label = "since") {
  const raw = String(value ?? "").trim();
  if (!TIMESTAMP_RE.test(raw)) throw new Error(label + " must be an ISO timestamp");
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error(label + " must be a valid ISO timestamp");
  return new Date(parsed).toISOString();
}

export function parseLimit(value, fallback = 20) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > TOOL_LIMITS.maxLimit) {
    throw new Error("limit must be an integer between 1 and " + TOOL_LIMITS.maxLimit);
  }
  return number;
}

export function parseMaxContextDays(since, until) {
  const start = parseISODate(since, "since");
  const end = parseISODate(until || start, "until");
  const startMs = Date.parse(start + "T00:00:00Z");
  const endMs = Date.parse(end + "T00:00:00Z");
  if (endMs < startMs) throw new Error("until must be on or after since");
  const days = Math.floor((endMs - startMs) / 86400000) + 1;
  if (days > TOOL_LIMITS.maxContextDays) {
    throw new Error("date window cannot exceed " + TOOL_LIMITS.maxContextDays + " days");
  }
  return { since: start, until: end, days };
}

export function parseCursor(value) {
  if (value == null || value === "") return null;
  const raw = String(value);
  try {
    const decoded = typeof atob === "function"
      ? atob(raw.replace(/-/g, "+").replace(/_/g, "/"))
      : Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || typeof parsed.updatedAt !== "string" || typeof parsed.sourceRecordId !== "string") throw new Error("invalid");
    return {
      updatedAt: parseSinceTimestamp(parsed.updatedAt, "cursor.updatedAt"),
      sourceRecordId: parsed.sourceRecordId.slice(0, 120)
    };
  } catch {
    throw new Error("cursor must be a valid page cursor");
  }
}

export function makeCursor(updatedAt, sourceRecordId) {
  const json = JSON.stringify({ updatedAt: parseSinceTimestamp(updatedAt, "updatedAt"), sourceRecordId: String(sourceRecordId).slice(0, 120) });
  if (typeof btoa === "function") return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return Buffer.from(json).toString("base64url");
}

function text(value, max = TOOL_LIMITS.maxText) {
  if (value == null) return undefined;
  const raw = String(value);
  return raw.length > max ? raw.slice(0, max) : raw;
}

function number(value) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value) {
  return typeof value === "boolean" ? value : undefined;
}

function dateOrNull(value) {
  if (value == null || value === "") return undefined;
  try { return parseISODate(value); } catch { return undefined; }
}

function timestampOrNull(value) {
  if (value == null || value === "") return undefined;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function pick(source, keys) {
  const output = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return output;
  keys.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) output[key] = source[key];
  });
  return output;
}

function capList(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function normalizeSet(raw, kind = "working") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = { type: kind === "warmup" ? "warmup" : "working" };
  const fields = ["id", "setNumber", "order", "status", "planned", "added", "skipped", "unit", "weight", "reps", "repsPerSide", "seconds", "rest", "completedAt", "note"];
  fields.forEach(key => {
    if (key === "planned" || key === "added" || key === "skipped") {
      const value = bool(raw[key]);
      if (value !== undefined) output[key] = value;
    } else if (["weight", "reps", "repsPerSide", "seconds", "rest", "setNumber", "order"].includes(key)) {
      const value = number(raw[key]);
      if (value !== undefined) output[key] = value;
    } else if (key === "completedAt") {
      const value = timestampOrNull(raw[key]);
      if (value) output[key] = value;
    } else {
      const value = text(raw[key], key === "note" ? 1000 : 200);
      if (value !== undefined) output[key] = value;
    }
  });
  if (kind !== "warmup") {
    const effort = text(raw.effort ?? raw.feel, 40);
    if (effort !== undefined) output.effort = effort;
    const rir = number(raw.rir);
    if (rir !== undefined) output.rir = rir;
  }
  return output;
}

export function normalizeProgramSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const dayKeys = Object.keys(raw).filter(key => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].includes(key));
  if (dayKeys.length && !Array.isArray(raw.exercises)) {
    return Object.fromEntries(dayKeys.map(day => [day, normalizeProgramSnapshot(raw[day])]).filter(([, value]) => value));
  }
  const output = pick(raw, ["schemaVersion", "title", "subtitle", "day", "programDay", "generalWarmup", "notes", "version"]);
  ["title", "subtitle", "day", "programDay", "notes", "version"].forEach(key => {
    if (output[key] !== undefined) output[key] = text(output[key], 300);
  });
  if (raw.generalWarmup && typeof raw.generalWarmup === "object") output.generalWarmup = pick(raw.generalWarmup, ["type", "durationMin", "speedMph", "inclinePercent", "notes"]);
  const exercises = capList(raw.exercises, TOOL_LIMITS.maxExercises).map(exercise => {
    if (!exercise || typeof exercise !== "object") return null;
    const item = pick(exercise, ["name", "type", "sets", "min", "max", "rest", "warm", "unilateral", "substitution", "unit", "machine", "loadType", "sides", "analyticsSets", "cue"]);
    ["name", "type", "warm", "substitution", "unit", "machine", "loadType", "cue"].forEach(key => { if (item[key] !== undefined) item[key] = text(item[key], 300); });
    ["sets", "min", "max", "rest", "sides", "analyticsSets"].forEach(key => { if (item[key] !== undefined) item[key] = number(item[key]); });
    if (item.unilateral !== undefined) item.unilateral = Boolean(item.unilateral);
    return item.name ? item : null;
  }).filter(Boolean);
  output.exercises = exercises;
  return output;
}

export function normalizeWorkout(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["id", "sessionId", "programDay", "day", "performedDate", "date", "status", "startedAt", "finishedAt", "endedAt", "durationSec", "durationSeconds", "timezone", "overallFeel", "feel", "sessionNote", "programSnapshot", "generalWarmup", "createdAt", "updatedAt"]);
  ["id", "sessionId", "programDay", "day", "status", "timezone", "overallFeel", "feel", "sessionNote"].forEach(key => { if (output[key] !== undefined) output[key] = text(output[key], key === "sessionNote" ? 2000 : 200); });
  ["performedDate", "date"].forEach(key => { if (output[key] !== undefined) output[key] = dateOrNull(output[key]); });
  ["startedAt", "finishedAt", "endedAt", "createdAt", "updatedAt"].forEach(key => { if (output[key] !== undefined) output[key] = timestampOrNull(output[key]); });
  ["durationSec", "durationSeconds"].forEach(key => { if (output[key] !== undefined) output[key] = number(output[key]); });
  if (output.programSnapshot) output.programSnapshot = normalizeProgramSnapshot(output.programSnapshot);
  if (raw.generalWarmup && typeof raw.generalWarmup === "object") output.generalWarmup = pick(raw.generalWarmup, ["type", "durationMin", "speedMph", "inclinePercent", "completed"]);
  const exercises = capList(raw.exercises, TOOL_LIMITS.maxExercises).map(exercise => {
    if (!exercise || typeof exercise !== "object") return null;
    const item = pick(exercise, ["id", "name", "type", "machine", "loadType", "unit", "rest", "planned", "completed", "substitution", "unilateral", "exerciseNote", "prescribed"]);
    ["id", "name", "type", "machine", "loadType", "unit", "substitution", "exerciseNote"].forEach(key => { if (item[key] !== undefined) item[key] = text(item[key], key === "exerciseNote" ? 1000 : 200); });
    if (item.rest !== undefined) item.rest = number(item.rest);
    ["planned", "completed", "unilateral"].forEach(key => { if (item[key] !== undefined) item[key] = Boolean(item[key]); });
    if (exercise.prescribed && typeof exercise.prescribed === "object") item.prescribed = normalizeProgramSnapshot({ exercises: [exercise.prescribed] }).exercises[0];
    const warmups = capList(exercise.warmups ?? exercise.warmupSets, TOOL_LIMITS.maxSets).map(set => normalizeSet(set, "warmup")).filter(Boolean);
    const working = capList(exercise.workingSets ?? exercise.sets, TOOL_LIMITS.maxSets).map(set => normalizeSet(set, "working")).filter(Boolean);
    if (warmups.length) item.warmups = warmups;
    if (working.length) item.workingSets = working;
    return item.name ? item : null;
  }).filter(Boolean);
  output.exercises = exercises;
  return output;
}

function normalizeCheckin(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["id", "date", "createdAt", "weight", "waist", "proteinTargetDays", "calorieTargetDays", "averageSteps", "hockeySessions", "yogaCompleted", "averageSleep", "sorenessRecovery", "notes"]);
  ["id", "sorenessRecovery", "notes"].forEach(key => { if (output[key] !== undefined) output[key] = text(output[key], 1000); });
  ["date"].forEach(key => { if (output[key] !== undefined) output[key] = dateOrNull(output[key]); });
  if (output.createdAt !== undefined) output.createdAt = timestampOrNull(output.createdAt);
  ["weight", "waist", "proteinTargetDays", "calorieTargetDays", "averageSteps", "hockeySessions", "averageSleep"].forEach(key => { if (output[key] !== undefined) output[key] = number(output[key]); });
  if (output.yogaCompleted !== undefined) output.yogaCompleted = Boolean(output.yogaCompleted);
  return output;
}

function normalizeNutritionEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["id", "date", "name", "calories", "protein", "carbs", "fat", "servings", "notes", "createdAt", "updatedAt"]);
  ["id", "name", "notes"].forEach(key => { if (output[key] !== undefined) output[key] = text(output[key], 1000); });
  if (output.date !== undefined) output.date = dateOrNull(output.date);
  ["createdAt", "updatedAt"].forEach(key => { if (output[key] !== undefined) output[key] = timestampOrNull(output[key]); });
  ["calories", "protein", "carbs", "fat", "servings"].forEach(key => { if (output[key] !== undefined) output[key] = number(output[key]); });
  return output;
}

function normalizeNutritionSummary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["id", "date", "calories", "protein", "carbs", "fat", "water", "steps", "notes", "createdAt", "updatedAt"]);
  ["id", "notes"].forEach(key => { if (output[key] !== undefined) output[key] = text(output[key], 1000); });
  if (output.date !== undefined) output.date = dateOrNull(output.date);
  ["createdAt", "updatedAt"].forEach(key => { if (output[key] !== undefined) output[key] = timestampOrNull(output[key]); });
  ["calories", "protein", "carbs", "fat", "water", "steps"].forEach(key => { if (output[key] !== undefined) output[key] = number(output[key]); });
  return output;
}

function normalizeNutritionTarget(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["calories", "protein", "stepsAverageTarget", "zone2SessionsPerWeek", "zone2DurationMin", "zone2DurationMax", "preferredZone2Day", "updatedAt"]);
  ["calories", "protein", "stepsAverageTarget", "zone2SessionsPerWeek", "zone2DurationMin", "zone2DurationMax"].forEach(key => { if (output[key] !== undefined) output[key] = number(output[key]); });
  if (output.preferredZone2Day !== undefined) output.preferredZone2Day = text(output.preferredZone2Day, 40);
  if (output.updatedAt !== undefined) output.updatedAt = timestampOrNull(output.updatedAt);
  return output;
}

function normalizeRecoveryActivity(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["id", "type", "performedDate", "date", "durationMin", "distance", "steps", "notes", "createdAt", "updatedAt"]);
  ["id", "type", "notes"].forEach(key => { if (output[key] !== undefined) output[key] = text(output[key], 500); });
  ["performedDate", "date"].forEach(key => { if (output[key] !== undefined) output[key] = dateOrNull(output[key]); });
  ["createdAt", "updatedAt"].forEach(key => { if (output[key] !== undefined) output[key] = timestampOrNull(output[key]); });
  ["durationMin", "distance", "steps"].forEach(key => { if (output[key] !== undefined) output[key] = number(output[key]); });
  return output;
}

export function normalizeProgramState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["schemaVersion", "source", "updatedAt", "currentProgram", "nextWeekProgram", "activities"]);
  if (output.source !== undefined) output.source = text(output.source, 100);
  if (output.updatedAt !== undefined) output.updatedAt = timestampOrNull(output.updatedAt);
  if (output.currentProgram) output.currentProgram = normalizeProgramSnapshot(output.currentProgram);
  if (output.nextWeekProgram) output.nextWeekProgram = normalizeProgramSnapshot(output.nextWeekProgram);
  if (output.activities && typeof output.activities === "object") {
    output.activities = Object.fromEntries(Object.entries(output.activities).slice(0, 14).map(([day, value]) => [text(day, 30), text(JSON.stringify(value), 2000)]));
  }
  return output;
}

function normalizeCoachingState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const output = pick(raw, ["reviewedWatermark", "reviewedAt", "completedAt", "updatedAt"]);
  ["reviewedWatermark", "reviewedAt", "completedAt", "updatedAt"].forEach(key => {
    if (output[key] !== undefined) output[key] = timestampOrNull(output[key]) || text(output[key], 120);
  });
  return output;
}

export function sanitizeCanonicalRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const recordType = String(row.record_type || row.recordType || "");
  if (!COACHING_RECORD_TYPES.includes(recordType)) return null;
  const sourceRecordId = String(row.source_record_id || row.sourceRecordId || "").trim();
  if (!sourceRecordId || sourceRecordId.length > 120) return null;
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.__deleted === true) return null;
  let data;
  if (recordType === "workout_session") data = normalizeWorkout(payload);
  else if (recordType === "checkin") data = normalizeCheckin(payload);
  else if (recordType === "nutrition_entry") data = normalizeNutritionEntry(payload);
  else if (recordType === "nutrition_summary") data = normalizeNutritionSummary(payload);
  else if (recordType === "nutrition_target") data = normalizeNutritionTarget(payload);
  else if (recordType === "recovery_activity") data = normalizeRecoveryActivity(payload);
  else if (recordType === "program_state") data = normalizeProgramState(payload);
  else data = normalizeCoachingState(payload);
  if (!data) return null;
  return {
    recordType,
    sourceRecordId,
    occurredOn: dateOrNull(row.occurred_on || row.occurredOn),
    updatedAt: timestampOrNull(row.updated_at || row.updatedAt),
    data
  };
}

export function isVisibleCoachingRecord(row) {
  return Boolean(sanitizeCanonicalRow(row));
}
