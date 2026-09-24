export const COACH_UPDATE_SCHEMA = "body-transformation-coach-update-v1";
export const COACH_PROGRAM_DAYS = Object.freeze(["Monday", "Friday", "Saturday", "Tuesday", "Wednesday", "Thursday", "Sunday"]);
export const COACH_PROGRAM_STRING_FIELDS = Object.freeze(["title", "subtitle", "type", "substitution", "unit", "machine", "loadType", "warm"]);
export const COACH_GUIDANCE_NUMERIC_FIELDS = Object.freeze([
  "calories",
  "protein",
  "stepsAverageTarget",
  "zone2SessionsPerWeek",
  "zone2DurationMin",
  "zone2DurationMax"
]);
export const COACH_WEIGHT_MIN_LB = 50;
export const COACH_WEIGHT_MAX_LB = 1000;
export const COACH_MAX_WEIGHT_ENTRIES = 14;

function invalid(path, message) {
  throw new Error(path + " " + message);
}

function nonEmptyString(value, path, max = 4000) {
  if (typeof value !== "string" || !value.trim()) invalid(path, "must be a non-empty string.");
  if (value.length > max) invalid(path, "must be " + max + " characters or fewer.");
  return value.trim();
}

function finiteNumber(value, path, min = 0) {
  const parsed = typeof value === "number" ? value : (typeof value === "string" && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(parsed) || parsed < min) invalid(path, "must be a finite number >= " + min + ".");
  return parsed;
}

function rangeOrNumber(value, path) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.min !== undefined && value.max !== undefined) {
    const min = finiteNumber(value.min, path + ".min");
    const max = finiteNumber(value.max, path + ".max");
    if (max < min) invalid(path + ".max", "must be greater than or equal to " + path + ".min.");
    const output = { min, max };
    if (value.bullseye !== undefined) output.bullseye = finiteNumber(value.bullseye, path + ".bullseye");
    return output;
  }
  return finiteNumber(value, path);
}

function strictISODate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(path, "must be an ISO date (YYYY-MM-DD).");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) invalid(path, "must be a real calendar date.");
  return value;
}

function validateWeightEntries(value) {
  if (!Array.isArray(value)) invalid("weightEntries", "must be an array.");
  if (value.length > COACH_MAX_WEIGHT_ENTRIES) invalid("weightEntries", "cannot contain more than " + COACH_MAX_WEIGHT_ENTRIES + " entries.");
  const seen = new Set();
  const output = value.map((entry, index) => {
    const path = "weightEntries[" + index + "]";
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid(path, "must be an object.");
    const date = strictISODate(entry.date, path + ".date");
    if (seen.has(date)) invalid(path + ".date", "duplicates another weight entry date.");
    seen.add(date);
    const weightLb = finiteNumber(entry.weightLb, path + ".weightLb", COACH_WEIGHT_MIN_LB);
    if (weightLb > COACH_WEIGHT_MAX_LB) invalid(path + ".weightLb", "must be <= " + COACH_WEIGHT_MAX_LB + ".");
    const note = entry.note === undefined || entry.note === null || entry.note === "" ? "" : nonEmptyString(entry.note, path + ".note", 500);
    return { date, weightLb, note };
  });
  return output.sort((a, b) => a.date.localeCompare(b.date));
}

function validateTargetGuidance(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string") return nonEmptyString(value, "targetGuidance", 2000);
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("targetGuidance", "must be an object or non-empty string.");
  const output = {};
  COACH_GUIDANCE_NUMERIC_FIELDS.forEach(key => {
    if (value[key] !== undefined) output[key] = rangeOrNumber(value[key], "targetGuidance." + key);
  });
  if (value.preferredZone2Day !== undefined) output.preferredZone2Day = nonEmptyString(value.preferredZone2Day, "targetGuidance.preferredZone2Day", 40);
  if (!Object.keys(output).length) invalid("targetGuidance", "must contain at least one supported coaching target.");
  return output;
}

function validateExercise(exercise, path) {
  if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) invalid(path, "must be an object.");
  const output = {};
  ["name", ...COACH_PROGRAM_STRING_FIELDS].forEach(key => {
    if (exercise[key] !== undefined && exercise[key] !== null) {
      if (typeof exercise[key] !== "string") invalid(path + "." + key, "must be a string when provided.");
      output[key] = String(exercise[key]).trim();
    }
  });
  output.name = nonEmptyString(exercise.name, path + ".name", 200);
  if (exercise.sets === undefined) invalid(path + ".sets", "is required.");
  const sets = finiteNumber(exercise.sets, path + ".sets", 1);
  if (!Number.isInteger(sets)) invalid(path + ".sets", "must be a whole number.");
  output.sets = sets;
  ["min", "max", "rest"].forEach(key => {
    if (exercise[key] === undefined) invalid(path + "." + key, "is required.");
    output[key] = finiteNumber(exercise[key], path + "." + key);
  });
  if (output.max < output.min) invalid(path + ".max", "must be greater than or equal to " + path + ".min.");
  ["unilateral"].forEach(key => {
    if (exercise[key] !== undefined) {
      if (typeof exercise[key] !== "boolean") invalid(path + "." + key, "must be true or false.");
      output[key] = exercise[key];
    }
  });
  ["sides", "analyticsSets"].forEach(key => {
    if (exercise[key] !== undefined) {
      output[key] = finiteNumber(exercise[key], path + "." + key, 1);
      if (!Number.isInteger(output[key])) invalid(path + "." + key, "must be a whole number.");
    }
  });
  return output;
}

function validateProgram(program) {
  if (!program || typeof program !== "object" || Array.isArray(program) || !Object.keys(program).length) {
    invalid("nextWeekProgram", "must be an object with workout-day keys.");
  }
  const output = {};
  Object.entries(program).forEach(([day, plan]) => {
    const path = "nextWeekProgram." + day;
    if (!COACH_PROGRAM_DAYS.includes(day)) invalid(path, "is not a supported day.");
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) invalid(path, "must be an object.");
    const clean = {};
    ["title", "subtitle"].forEach(key => {
      if (plan[key] !== undefined) clean[key] = nonEmptyString(plan[key], path + "." + key, 300);
    });
    if (!Array.isArray(plan.exercises)) invalid(path + ".exercises", "must be an array.");
    if (plan.exercises.length > 32) invalid(path + ".exercises", "cannot contain more than 32 exercises.");
    clean.exercises = plan.exercises.map((exercise, index) => validateExercise(exercise, path + ".exercises[" + index + "]"));
    output[day] = clean;
  });
  return output;
}

export function isPastProgramEffectiveDate(value, todayISO = new Date().toISOString().slice(0, 10)) {
  const effectiveDate = strictISODate(value, "programEffectiveDate");
  const currentDate = strictISODate(todayISO, "today");
  return effectiveDate < currentDate;
}

export function validateCoachUpdate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid("$", "must be an object.");
  if (payload.schema !== COACH_UPDATE_SCHEMA) invalid("schema", "must equal " + COACH_UPDATE_SCHEMA + ".");
  const output = {
    schema: COACH_UPDATE_SCHEMA,
    sourcePackageId: nonEmptyString(payload.sourcePackageId, "sourcePackageId", 160),
    coachSummary: nonEmptyString(payload.coachSummary, "coachSummary", 4000)
  };
  if (payload.nextWeekProgram !== undefined) output.nextWeekProgram = validateProgram(payload.nextWeekProgram);
  if (payload.targetGuidance !== undefined) output.targetGuidance = validateTargetGuidance(payload.targetGuidance);
  if (payload.weightEntries !== undefined) output.weightEntries = validateWeightEntries(payload.weightEntries);
  if (payload.programEffectiveDate !== undefined) output.programEffectiveDate = strictISODate(payload.programEffectiveDate, "programEffectiveDate");
  return output;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

export function payloadHash(value) {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeExpectedWatermark(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) invalid("expectedWatermark", "must be a valid ISO timestamp or null.");
  return new Date(parsed).toISOString();
}
