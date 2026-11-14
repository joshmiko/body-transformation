import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");

test("the app is called Shift everywhere a user sees its name", async () => {
  const [html, manifest, consent] = await Promise.all([read("index.html"), read("manifest.json"), read("oauth/consent.html")]);
  assert.match(html, /<title>Shift<\/title>/);
  assert.match(html, /<div class="brand">Shift<\/div>/);
  assert.match(html, /Sign in to Shift/);
  assert.doesNotMatch(html, /Body Transformation V13|Sign in to Body Transformation|class="brand">Body Transformation/);
  assert.equal(JSON.parse(manifest).name, "Shift");
  assert.match(consent, /your Shift training data/);
});

test("user-facing app copy never mentions ChatGPT", async () => {
  for (const file of ["index.html", "manifest.json", "oauth/consent.html"]) {
    assert.doesNotMatch(await read(file), /ChatGPT|chatgpt\.com/i, file);
  }
});

test("renaming keeps storage keys and data identifiers unchanged", async () => {
  const html = await read("index.html");
  // Changing these would sign people out or orphan saved data.
  for (const marker of ["body-transformation-coaching-package-v2", "body-transformation-coach-update-v1"]) {
    assert.ok(html.includes(marker), marker);
  }
});
