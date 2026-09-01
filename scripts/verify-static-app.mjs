import { readFile } from "node:fs/promises";

const [html, manifest, program] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../program.json", import.meta.url), "utf8"),
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
  Friday: [["Deadlift", 2, 5, 6], ["Pull-Ups", 3, 3, 6], ["Incline DB Bench", 3, 8, 12], ["Cable Row", 3, 8, 12], ["Walking Lunge", 2, 8, 10], ["DB Curl", 2, 10, 15]],
  Saturday: [["Leg Press", 3, 8, 12], ["DB Romanian Deadlift", 3, 8, 12], ["Walking Lunge", 2, 8, 10], ["Calf Raise", 3, 10, 15], ["Dead Hang", 2, 20, 45]]
})) {
  const actual = (embeddedProgram[day]?.exercises || []).map(ex => [ex.name, ex.sets, ex.min, ex.max]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected ${day} program configuration`);
}
if (embeddedProgram.Saturday.exercises.find(ex => ex.name === "Dead Hang")?.unit !== "sec") throw new Error("Dead Hang must remain seconds-based");
if (embeddedProgram.Saturday.exercises.find(ex => ex.name === "Leg Press")?.machine !== "Matrix") throw new Error("Leg Press must remain Matrix-specific");
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
