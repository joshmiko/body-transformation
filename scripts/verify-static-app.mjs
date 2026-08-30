import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const [html, manifest] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
]);

if (!html.includes("<meta name=\"viewport\"")) throw new Error("Missing responsive viewport metadata");
if (!html.includes('rel="manifest"')) throw new Error("Missing web manifest link");
if (!html.includes("const PROGRAM=")) throw new Error("Missing workout program configuration");

const parsedManifest = JSON.parse(manifest);
for (const field of ["name", "short_name", "start_url", "display"]) {
  if (!parsedManifest[field]) throw new Error(`Manifest is missing ${field}`);
}

console.log("Static app verification passed.");


for (const file of ["src/supabase-rest.js", "src/passkey-auth.js"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`JavaScript syntax check failed for ${file}: ${result.stderr}`);
}
const inlineScripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)].map(match => match[1]);
if (inlineScripts.length !== 1) throw new Error("Expected exactly one inline application script");
try {
  new Function(inlineScripts[0]);
} catch (error) {
  throw new Error(`Inline application script syntax check failed: ${error.message}`);
}
