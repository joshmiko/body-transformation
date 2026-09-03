import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("required development and recovery documentation exists", async () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/CODEOWNERS",
    "docs/release-and-rollback.md",
    "docs/migrations.md",
    "docs/github-settings.md",
  ]) await access(new URL(path, root));
});

test("verification runs for pull requests and main", async () => {
  const workflow = await read(".github/workflows/verify.yml");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /npm run ci/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
});

test("deployment is restricted, serialized, and independently verified", async () => {
  const workflow = await read(".github/workflows/deploy-pages.yml");
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /npm run ci/);
  assert.match(workflow, /environment:\s*\n\s*name: github-pages/);
});

test("migration filenames are versioned and ordered", async () => {
  const entries = (await readdir(new URL("supabase/migrations/", root))).filter(x => x.endsWith(".sql"));
  assert.ok(entries.length > 0);
  for (const name of entries) assert.match(name, /^\d{12}_[a-z0-9_]+\.sql$/);
  assert.deepEqual(entries, [...entries].sort());
});

test("client configuration does not document privileged secrets", async () => {
  const readme = await read("README.md");
  const settings = await read("docs/github-settings.md");
  assert.match(readme, /Never put privileged Supabase keys or AI API keys in client files/);
  assert.match(settings, /Never store a Supabase service-role key/);
});
