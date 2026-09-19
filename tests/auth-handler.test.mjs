import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("static sign-in has one canonical listener and no inline duplicate handlers", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal((html.match(/addEventListener\("click",btStaticSignIn\)/g) || []).length, 1);
  assert.equal((html.match(/addEventListener\("click",btStaticPasskey\)/g) || []).length, 1);
  assert.equal((html.match(/onclick="btStaticSignIn\(\)"/g) || []).length, 0);
  assert.equal((html.match(/onclick="btStaticPasskey\(\)"/g) || []).length, 0);
  assert.match(html, /function btStaticSignIn\(\)/);
});
