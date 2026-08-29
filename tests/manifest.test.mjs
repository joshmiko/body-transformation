import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest describes a standalone app", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8")
  );

  assert.equal(manifest.name, "Body Transformation");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.start_url);
});
