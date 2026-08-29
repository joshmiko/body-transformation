import { readFile } from "node:fs/promises";

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
