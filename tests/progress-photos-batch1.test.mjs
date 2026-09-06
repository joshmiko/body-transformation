import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const script=html.slice(html.lastIndexOf("<script>")+8,html.lastIndexOf("</script>"));
const helperStart=script.indexOf("const PROGRESS_PHOTO_MAX_DIMENSION");
const helperEnd=script.indexOf("function blobToDataUrl",helperStart);
const helperCode=script.slice(helperStart,helperEnd)+";return {progressPhotoInputError,fitProgressPhotoDimensions,progressPhotoIdentity,replaceProgressPhotoList};";
const helpers=new Function("weekStart","today",helperCode)(value=>new Date(value),()=> "2026-09-06");

test("three exact angle slots target their own picker",()=>{
  for(const angle of ["Front","Side","Back"]) assert.match(html,new RegExp("data-photo-angle=.{0,5}"+angle));
  assert.match(html,/chooseProgressPhoto\(\'[^']+\',\'Front\'\)/);
  assert.match(html,/chooseProgressPhoto\(\'[^']+\',\'Side\'\)/);
  assert.match(html,/chooseProgressPhoto\(\'[^']+\',\'Back\'\)/);
  assert.doesNotMatch(html,/class="photo-angle"/);
});

test("replacement keeps one current photo per week and angle",()=>{
  const old={id:"old",weekKey:"2026-08-31",angle:"Front",data:"old"};
  const side={id:"side",weekKey:"2026-08-31",angle:"Side",data:"side"};
  const next={id:"new",weekKey:"2026-08-31",angle:"Front",data:"new"};
  const result=helpers.replaceProgressPhotoList([old,side],next);
  assert.deepEqual(result,[side,next]);
  assert.equal(result.filter(x=>x.weekKey==="2026-08-31"&&x.angle==="Front").length,1);
});

test("compression dimensions are bounded and preserve aspect ratio",()=>{
  assert.deepEqual(helpers.fitProgressPhotoDimensions(3024,4032),{width:960,height:1280});
  assert.deepEqual(helpers.fitProgressPhotoDimensions(800,600),{width:800,height:600});
  assert.match(html,/PROGRESS_PHOTO_MAX_DIMENSION=1280/);
  assert.match(html,/PROGRESS_PHOTO_QUALITY=.78/);
  assert.match(html,/imageOrientation:"from-image"/);
});

test("unsupported and oversized files produce plain-language errors",()=>{
  assert.match(helpers.progressPhotoInputError({type:"text/plain",size:100}),/image from your camera roll/);
  assert.match(helpers.progressPhotoInputError({type:"image/jpeg",size:26*1024*1024}),/too large/);
  assert.equal(helpers.progressPhotoInputError({type:"image/jpeg",size:100}),null);
  assert.match(html,/Photo processing is unavailable/);
  assert.match(html,/photo could not be saved/);
});

test("existing local photos are preserved and rendered",()=>{
  assert.match(html,/out\.progressPics=Array\.isArray\(out\.progressPics\)/);
  assert.match(html,/db\.progressPics=replaceProgressPhotoList/);
  assert.match(html,/reader\.result|data:image\/jpeg/);
  assert.match(html,/deleteProgressPhoto/);
});

test("processing, saving, saved, and failure states are visible",()=>{
  for(const state of ["Processing photo","Saving photo","Saved","Photo could not be saved"]) assert.match(html,new RegExp(state));
  assert.match(html,/data-photo-status/);
});

test("progress photos remain local-only in Batch 1",()=>{
  assert.doesNotMatch(html,/supabase.*storage/i);
  assert.doesNotMatch(html,/createSignedUrl|upload\(/i);
});

test("other app areas remain wired",()=>{
  for(const marker of ["function progress()","function dashboardOverview","function nutrition()","function render(","function buildCoachingPackage","bt_supabase_session","localStorage"]) assert.ok(html.includes(marker),marker);
});
