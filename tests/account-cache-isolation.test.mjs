import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountScopedStorageKey } from "../src/supabase-rest.js";

test("canonical queue and metadata storage are scoped by user", () => {
  assert.equal(accountScopedStorageKey("bt_queue", "user-a"), "bt_queue:user-a");
  assert.equal(accountScopedStorageKey("bt_queue", "user-b"), "bt_queue:user-b");
  assert.notEqual(accountScopedStorageKey("bt_queue", "user-a"), accountScopedStorageKey("bt_queue", "user-b"));
  assert.equal(accountScopedStorageKey("bt_queue", ""), "bt_queue:anonymous");
});

test("account switching resets the local cache before rehydration", async () => {
  const [index, rest] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/supabase-rest.js", import.meta.url), "utf8")
  ]);
  assert.match(index, /btDbStorageKey/);
  assert.match(index, /bt10_db_unscoped_quarantine_v1/);
  assert.match(index, /if\(previousUserId!==data\.user\?\.id\)btResetForAccount\(data\.user\?\.id\)/);
  assert.match(index, /window\.btSupabase\?\.signOut\?\.\(\)/);
  assert.doesNotMatch(index, /function btSignOut\(\)\{localStorage\.removeItem\("bt_supabase_session"\)/);
  assert.match(rest, /accountScopedStorageKey/);
  assert.match(rest, /getItem\(canonicalQueueKey\(\)\)/);
  assert.match(rest, /getItem\(canonicalMetaKey\(\)\)/);
});
