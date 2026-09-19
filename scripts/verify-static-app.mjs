import { readFile } from "node:fs/promises";

const [html, manifest, program, mcpServer, mcpBridge, consentRoute, consentHelper, migration, writeMigration, writeBridge, supabaseConfig] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../program.json", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/coaching-mcp/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/coaching-mcp/bridge.mjs", import.meta.url), "utf8"),
  readFile(new URL("../oauth/consent.html", import.meta.url), "utf8"),
  readFile(new URL("../oauth/consent.mjs", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202609170001_program_state_canonical.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202609190001_coaching_bridge_write_queue.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/coaching-mcp/write-bridge.mjs", import.meta.url), "utf8"),
  readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
]);

if (!html.includes("<meta name=\"viewport\"")) throw new Error("Missing responsive viewport metadata");
if (!html.includes('rel="manifest"')) throw new Error("Missing web manifest link");
if (!html.includes("const PROGRAM=")) throw new Error("Missing workout program configuration");

const parsedManifest = JSON.parse(manifest);
const parsedProgram = JSON.parse(program);
const programStart = html.indexOf("const PROGRAM=") + "const PROGRAM=".length;
const programEnd = html.indexOf(",PROGRAM_VERSION=", programStart);
if (programStart < "const PROGRAM=".length || programEnd < 0) throw new Error("Could not locate embedded program configuration");
const embeddedProgram = JSON.parse(html.slice(programStart, programEnd));
if (JSON.stringify(embeddedProgram) !== JSON.stringify(parsedProgram)) throw new Error("Embedded program does not match program.json");
for (const [day, expected] of Object.entries({
  Monday: [["Back Squat", 3, 5, 8], ["Barbell Bench Press", 3, 5, 8], ["Lat Pulldown", 3, 8, 12], ["1-Arm DB Row", 2, 8, 12], ["Single-Arm Cable Lateral Raise", 2, 12, 20], ["DB Hammer Curl", 2, 10, 15]],
  Friday: [["Deadlift", 2, 5, 6], ["Pull-Ups", 3, 3, 6], ["Dead Hang", 2, 20, 45], ["Incline DB Bench", 3, 8, 12], ["Cable Row", 3, 8, 12], ["Walking Lunge", 2, 8, 10], ["DB Curl", 2, 10, 15], ["Rope Overhead Cable Triceps Extension", 2, 10, 15]],
  Saturday: [["Leg Press", 3, 8, 12], ["Barbell Romanian Deadlift", 2, 8, 10], ["Seated Leg Curl", 2, 10, 15], ["DB Shoulder Press", 3, 8, 12], ["DB Flat Bench", 2, 8, 12], ["DB Lateral Raise", 2, 12, 20], ["Calf Raise", 2, 12, 20]]
})) {
  const actual = (embeddedProgram[day]?.exercises || []).map(ex => [ex.name, ex.sets, ex.min, ex.max]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected ${day} program configuration`);
}
if (embeddedProgram.Friday.exercises.find(ex => ex.name === "Dead Hang")?.unit !== "sec") throw new Error("Dead Hang must remain seconds-based");
if (embeddedProgram.Saturday.exercises.find(ex => ex.name === "Leg Press")?.machine !== "Matrix") throw new Error("Leg Press must remain Matrix-specific");
if (embeddedProgram.Friday.exercises.find(ex => ex.name === "Rope Overhead Cable Triceps Extension")?.rest !== 75) throw new Error("Friday trial triceps rest must remain 75 seconds");
if (embeddedProgram.Saturday.exercises.find(ex => ex.name === "Seated Leg Curl")?.rest !== 75) throw new Error("Saturday trial leg curl rest must remain 75 seconds");
if (embeddedProgram.Tuesday || embeddedProgram.activities?.Tuesday?.coreGuidance?.name !== "Dead Bug") throw new Error("Tuesday core must remain recovery guidance, not lifting");
if (!html.includes("50–55 minutes planned; 60-minute maximum")) throw new Error("Session timing guidance is outdated");
if (!html.includes("__BT_PROGRAM_STATE__")) throw new Error("Program state sync hook is missing");
for (const tool of ["list_recent_workouts", "get_workout", "get_coaching_context", "get_changes_since"]) {
  if (!mcpServer.includes(tool)) throw new Error("Missing coaching MCP tool: " + tool);
}
if (!mcpServer.includes('withSupabase({ auth: "user" })')) throw new Error("Coaching MCP must use user-scoped Supabase auth");
if (!mcpServer.includes("readOnlyHint: true")) throw new Error("Coaching MCP tools must be annotated read-only");
if (/service_role|SUPABASE_SERVICE_ROLE_KEY|database password/i.test(mcpServer)) throw new Error("Privileged credentials must not appear in the Edge Function");
if (/access_token|refresh_token|service_role/i.test(consentRoute)) throw new Error("Consent route must not expose credentials");
if (!consentRoute.includes("getAuthorizationDetails") || !consentRoute.includes("approveAuthorization") || !consentRoute.includes("denyAuthorization")) throw new Error("OAuth consent operations are incomplete");
if (!consentHelper.includes("authorization_id")) throw new Error("OAuth consent helper is incomplete");
if (!mcpBridge.includes("sanitizeCanonicalRow") || !mcpBridge.includes("TOOL_LIMITS")) throw new Error("Coaching bridge normalization is missing");
if (!migration.includes("'program_state'")) throw new Error("Program-state migration is missing");
if (!writeBridge.includes("validateCoachUpdate")) throw new Error("Coach update validation is missing");
if (!writeMigration.includes("coaching_update_requests") || !writeMigration.includes("block oauth clients from legacy data")) throw new Error("Coach update write queue migration is missing");
if ((html.match(/addEventListener\("click",btStaticSignIn\)/g) || []).length !== 1) throw new Error("Sign-in must have exactly one canonical click handler");
if ((html.match(/addEventListener\("click",btStaticPasskey\)/g) || []).length !== 1) throw new Error("Passkey must have exactly one canonical click handler");
if (/onclick="btStaticSignIn\(\)"|onclick="btStaticPasskey\(\)"/.test(html)) throw new Error("Sign-in handlers must not be inline");
if (!supabaseConfig.includes("[functions.coaching-mcp]") || !supabaseConfig.includes("verify_jwt = false")) throw new Error("MCP function discovery config is missing");
const monday = embeddedProgram.Monday.exercises;
const restByName = Object.fromEntries(monday.map(ex => [ex.name, ex.rest]));
for (const [name, seconds] of [["Back Squat", 150], ["Barbell Bench Press", 150], ["Lat Pulldown", 90], ["1-Arm DB Row", 75], ["DB Hammer Curl", 60]]) {
  if (restByName[name] !== seconds) throw new Error(`Unexpected Monday rest for ${name}`);
}
const cableLateral = monday.find(ex => ex.name === "Single-Arm Cable Lateral Raise");
if (!cableLateral?.unilateral || cableLateral.sides !== 2 || cableLateral.analyticsSets !== 2 || cableLateral.substitution !== "DB Lateral Raise") {
  throw new Error("Single-arm cable lateral raise semantics are incomplete");
}

if (html.includes("review-rir") || html.includes('placeholder="RIR"') || html.includes('rir:""')) throw new Error("RIR must not be rendered or written by new workout flows");
for (const marker of ["function rowAction", "data-swipe-row", "function bindSwipeRows", "function cancelActiveWorkout", "Cancel this workout?", "Your unsaved sets will be discarded.", "review-duration", "workout-header", "session-duration", "form-cue-callout"]) {
  if (!html.includes(marker)) throw new Error(`Missing approved refinement: ${marker}`);
}

for (const field of ["name", "short_name", "start_url", "display"]) {
  if (!parsedManifest[field]) throw new Error(`Manifest is missing ${field}`);
}

console.log("Static app verification passed.");
