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
  assert.match(client,/export (?:async )?function createProgressPhotoSignedUrl/);
  assert.match(client,/export function deleteProgressPhotoObject/);
  assert.match(client,/storage\/v1/);
  assert.match(client,/progress-photos/);
});

test("replacement uploads before removing prior cloud object",()=>{
  const upload=app.indexOf("await window.btSupabase.uploadProgressPhoto");
  const metadata=app.indexOf("upsertProgressPhotoMetadata",upload);
  const cleanup=app.indexOf("deleteProgressPhotoObject(priorPath)",metadata);
  assert.ok(upload>=0&&metadata>upload&&cleanup>metadata);
  assert.match(client,/on_conflict=user_id%2Cweek_start%2Cangle/);
});

test("legacy local photos are retained and cloud failures are non-blocking",()=>{
  assert.match(app,/syncLegacyProgressPhotosToCloud/);
  assert.ok(app.includes("btWriteDbForAccount(db)"));
  assert.ok(!app.includes('localStorage.setItem("bt10_db"'));
  assert.match(app,/Offline or cloud sync unavailable; local photos remain available/);
  assert.match(app,/Removed on this device; cloud cleanup will retry when connected/);
  assert.match(app,/photo\.cloudStatus="pending"/);
});

test("signed URLs are used for cloud-only retrieval with local fallback",()=>{
  assert.match(app,/createProgressPhotoSignedUrl\(row\.storage_path/);
  assert.match(app,/existing\.data=existing\.data\|\|url/);
  assert.match(app,/data-cloud-progress-status/);
});

function photoSyncHarness(photos, cloudRows=[], overrides={}) {
  const start=app.indexOf("let progressCloudState=");
  const end=app.indexOf("async function handleProgressPhotoInput",start);
  assert.ok(start>=0&&end>start);
  const db={progressPics:photos};
  const calls={uploads:[],metadata:[],deleted:[],saves:0};
  const btSupabase={
    sessionActive:()=>true,
    currentUser:()=>({id:"user-a"}),
    listProgressPhotoMetadata:async()=>cloudRows,
    createProgressPhotoSignedUrl:async()=>({signedURL:"https://example.invalid/photo"}),
    uploadProgressPhoto:async(path)=>{calls.uploads.push(path)},
    upsertProgressPhotoMetadata:async(row)=>{calls.metadata.push(row);return {id:"cloud-row"}},
    deleteProgressPhotoObject:async(path)=>{calls.deleted.push(path)},
    ...overrides
  };
  const run=new Function("db","window","fetch","save","btWriteDbForAccount","progress","document","progressPhotoIdentity","progressWeekKey",app.slice(start,end)+";return {loadProgressPhotosFromCloud,syncLegacyProgressPhotosToCloud};");
  const api=run(db,{btSupabase},async()=>({ok:true,blob:async()=>({size:123})}),()=>{calls.saves++},()=>{},()=>{},{querySelectorAll:()=>[],querySelector:()=>null},photo=>photo.weekKey+"::"+photo.angle,()=>"2026-09-14");
  return {db,calls,...api};
}

test("pending device photos retry during cloud loading and keep their local image",async()=>{
  const data="data:image/jpeg;base64,local-photo";
  const photo={id:"local-1",weekKey:"2026-09-14",date:"2026-09-20",angle:"Front",data,cloudStatus:"pending"};
  const h=photoSyncHarness([photo]);
  await h.loadProgressPhotosFromCloud();
  assert.equal(h.calls.uploads.length,1);
  assert.equal(h.calls.metadata.length,1);
  assert.equal(photo.data,data);
  assert.equal(photo.cloudStatus,"synced");
  assert.match(photo.cloudPath,/user-a\/2026-09-14\/front-local-1\.jpg/);
});

test("a failed retry never replaces an unsynced device photo with an older cloud photo",async()=>{
  const data="data:image/jpeg;base64,new-local-photo";
  const photo={id:"local-2",weekKey:"2026-09-14",date:"2026-09-20",angle:"Side",data,cloudStatus:"pending"};
  const oldPath="user-a/2026-09-14/side-old.jpg";
  const rows=[{id:"old-row",week_start:"2026-09-14",angle:"Side",storage_path:oldPath}];
  const h=photoSyncHarness([photo],rows,{uploadProgressPhoto:async(path)=>{h.calls.uploads.push(path);throw new Error("offline")}});
  await h.loadProgressPhotosFromCloud();
  assert.equal(photo.data,data);
  assert.equal(photo.cloudStatus,"pending");
  assert.equal(photo.cloudPath,undefined);
  assert.equal(photo.pendingPreviousCloudPath,oldPath);
  assert.deepEqual(h.calls.deleted,[]);
});

test("successful retry replaces metadata before removing the old cloud object",async()=>{
  const data="data:image/jpeg;base64,new-local-photo";
  const photo={id:"local-3",weekKey:"2026-09-14",date:"2026-09-20",angle:"Back",data,cloudStatus:"pending"};
  const oldPath="user-a/2026-09-14/back-old.jpg";
  const rows=[{id:"old-row",week_start:"2026-09-14",angle:"Back",storage_path:oldPath}];
  const order=[];
  const h=photoSyncHarness([photo],rows,{
    upsertProgressPhotoMetadata:async()=>{order.push("metadata");return {id:"new-row"}},
    deleteProgressPhotoObject:async path=>{order.push("delete");assert.equal(path,oldPath)}
  });
  await h.loadProgressPhotosFromCloud();
  assert.deepEqual(order,["metadata","delete"]);
  assert.equal(photo.data,data);
  assert.equal(photo.cloudStatus,"synced");
  assert.equal(photo.pendingPreviousCloudPath,undefined);
});

test("an older cloud response cannot overwrite a photo just synced on this device",async()=>{
  const data="data:image/jpeg;base64,newer-local-photo";
  const photo={id:"local-4",weekKey:"2026-09-14",date:"2026-09-20",angle:"Front",data,cloudPath:"user-a/2026-09-14/front-local-4.jpg",cloudSyncedAt:"2026-09-20T12:00:00Z",cloudStatus:"synced"};
  const rows=[{id:"old-row",week_start:"2026-09-14",angle:"Front",storage_path:"user-a/2026-09-14/front-old.jpg",updated_at:"2026-09-20T11:00:00Z"}];
  const h=photoSyncHarness([photo],rows);
  await h.loadProgressPhotosFromCloud();
  assert.equal(photo.data,data);
  assert.equal(photo.cloudPath,"user-a/2026-09-14/front-local-4.jpg");
  assert.equal(h.calls.uploads.length,0);
});

test("photo retries may replace the same private object after a partial upload",()=>{
  assert.match(client,/uploadProgressPhoto[\s\S]*?"x-upsert": "true"/);
  assert.match(migration,/for select to authenticated/);
  assert.match(migration,/for update to authenticated/);
});
