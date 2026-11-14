import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Loads index.html in a real browser and fails on any uncaught error during
// startup. Skips when Playwright isn't available (it isn't a project dependency).
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch {}

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(root, path === "/" ? "index.html" : path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("index.html starts without uncaught page errors", { skip: chromium ? false : "playwright not installed", timeout: 60000 }, async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    try {
      browser = await chromium.launch();
    } catch (error) {
      test.skip?.(`chromium unavailable: ${error.message}`);
      return;
    }
    const page = await browser.newPage();
    // Keep the test hermetic: only the local server is reachable.
    await page.route("**/*", route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/", { waitUntil: "load" });
    await page.waitForTimeout(500);
    assert.deepEqual(errors, [], `uncaught errors at startup:\n${errors.join("\n")}`);
    const exported = await page.evaluate(() => typeof window.addSet === "function" && typeof window.home === "function");
    assert.ok(exported, "functions after the old stray name should be exported to window");
  } finally {
    await browser?.close();
    server.close();
  }
});
