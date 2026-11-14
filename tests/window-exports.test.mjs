import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

// The main inline script is the last <script> block in the page; it ends with
// `Object.assign(window,{...})`, which makes functions reachable from inline
// onclick handlers. Any name in that list that isn't defined throws a
// ReferenceError on load and stops everything after it (e.g. the cloud refresh).
function mainScript() {
  const end = html.lastIndexOf("</script>");
  const start = html.lastIndexOf("<script>", end);
  assert.ok(start >= 0 && end > start, "main inline script should exist");
  return html.slice(start + "<script>".length, end);
}

function exportedNames(script) {
  const matches = [...script.matchAll(/Object\.assign\(window,\{([^}]*)\}\)/g)];
  assert.ok(matches.length > 0, "main script should export functions with Object.assign(window,{...})");
  return matches.flatMap(match => match[1].split(",").map(name => name.trim()).filter(Boolean));
}

const escape = name => name.replace(/[$]/g, "\\$");

function definesFunction(script, name) {
  const id = escape(name);
  const patterns = [
    new RegExp(`(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s*${id}\\s*\\(`),
    new RegExp(`(?:^|[^\\w$.])(?:const|let|var)\\s+${id}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)`),
    new RegExp(`[,;]\\s*${id}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)`),
  ];
  return patterns.some(pattern => pattern.test(script));
}

test("every name exported via Object.assign(window,{...}) is defined as a function", () => {
  const script = mainScript();
  const names = exportedNames(script);
  assert.ok(names.length > 10, "export list should be parsed");
  for (const name of names) {
    assert.match(name, /^[A-Za-z_$][\w$]*$/, `export list entry should be a plain identifier (got "${name}")`);
  }
  const missing = names.filter(name => !definesFunction(script, name));
  assert.deepEqual(missing, [], `exported names with no function definition in index.html: ${missing.join(", ")}`);
});

test("export list contains no duplicates", () => {
  const names = exportedNames(mainScript());
  const dupes = names.filter((name, i) => names.indexOf(name) !== i);
  assert.deepEqual(dupes, []);
});

test("the stray nextScheduledWorkoutDay export does not come back", () => {
  assert.ok(!exportedNames(mainScript()).includes("nextScheduledWorkoutDay"));
});
