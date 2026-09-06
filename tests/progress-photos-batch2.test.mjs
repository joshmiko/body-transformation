import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const app=fs.readFileSync(path.join(root,"index.html"),"utf8");
const client=fs.readFileSync(path.join(root,"src","supabase-rest.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"supabase","migrations","202609060002_progress_photos.sql"),"utf8");

test("private per-user storage migration exists",()=>{
  assert.match(migration,/create table if not exists public\.progress_photos/);
  assert.match(migration,/unique \(user_id, week_start, angle\)/);
  assert.match(migration,/values \('progress-photos', 'progress-photos', false/);
  assert.match(migration,/using \(bucket_id = 'progress-photos'/);
  assert.match(migration,/storage\.foldername\(name\)\)\[1\]/);
  assert.match(migration,/for delete to authenticated/);
});

test("metadata maps user, week, angle, and private storage path",()=>{
  for(const field of ["user_id","week_start","captured_on","angle","storage_path"]) assert.match(migration,new RegExp(field));
  assert.match(app,/week_start:photo\.weekKey/);
  assert.match(app,/storage_path:path/);
  assert.match(app,/photo\.cloudPath=path/);
});

test("Storage client exposes upload, signed URL, and delete operations",()=>{
  assert.match(client,/export function uploadProgressPhoto/);
  assert.match(client,/export function createProgressPhotoSignedUrl/);
  assert.match(client,/export function deleteProgressPhotoObject/);
  assert.match(client,/storage\/v1/);
  assert.match(client,/progress-photos/);
});

test("replacement uploads before removing prior cloud object",()=>{
  const upload=app.indexOf("await window.btSupabase.uploadProgressPhoto");
  const metadata=app.indexOf("upsertProgressPhotoMetadata",upload);
  const cleanup=app.indexOf("deleteProgressPhotoObject(previousCloudPath)",metadata);
  assert.ok(upload>=0&&metadata>upload&&cleanup>metadata);
  assert.match(client,/on_conflict=user_id%2Cweek_start%2Cangle/);
});

test("legacy local photos are retained and cloud failures are non-blocking",()=>{
  assert.match(app,/syncLegacyProgressPhotosToCloud/);
  assert.match(app,/localStorage\.setItem\("bt10_db"/);
  assert.match(app,/Offline or cloud sync unavailable; local photos remain available/);
  assert.match(app,/Removed on this device; cloud cleanup will retry when connected/);
  assert.match(app,/photo\.cloudStatus="pending"/);
});

test("signed URLs are used for cloud-only retrieval with local fallback",()=>{
  assert.match(app,/createProgressPhotoSignedUrl\(row\.storage_path/);
  assert.match(app,/existing\.data=existing\.data\|\|url/);
  assert.match(app,/data-cloud-progress-status/);
});
