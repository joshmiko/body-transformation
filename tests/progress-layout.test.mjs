import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("a last Progress tile that would sit alone spans the full row", () => {
  assert.ok(html.includes(".progress-secondary .dash-tile:last-child:nth-child(odd){grid-column:1/-1}"));
  const dashboard = html.match(/<div class="progress-secondary">[\s\S]*?signals to review<\/div><\/div><\/div>/)?.[0] || "";
  const tiles = (dashboard.match(/<div class="dash-tile">/g) || []).length;
  assert.equal(tiles % 2, 1, "an odd number of tiles is what this rule handles; revisit it if the count changes");
});
