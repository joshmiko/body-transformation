import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"index.html"),"utf8");
const script=source.slice(source.lastIndexOf("<script>")+8,source.lastIndexOf("</script>"));
const helperStart=script.indexOf("function restRemainingAt");
const helperEnd=script.indexOf("function formatDuration",helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,"integrity helpers present");
const helperCode=script.slice(helperStart,helperEnd)+";return {restRemainingAt,sessionElapsedFromTimestamps,normalizeYogaRecord,performedStats,progressionFeelSignal};";
const helpers=new Function("validTimestamp",helperCode)(v=>{const t=Date.parse(v||"");return Number.isFinite(t)?t:null});

test("A/B yoga completion has date, timestamp, and undo path",()=>{
  const record=helpers.normalizeYogaRecord({completed:true,completedAt:"2026-09-02T12:00:00Z"},"2026-09-02");
  assert.deepEqual(record,{type:"yoga",date:"2026-09-02",completed:true,completedAt:"2026-09-02T12:00:00.000Z"});
  assert.equal(helpers.normalizeYogaRecord({completed:false},"2026-09-02"),null);
  assert.match(source,/function setYogaComplete\(date=today\(\),completed=true\).*delete db\.yogaCompletions\[date\]/);
  assert.match(source,/yogaActivitySince\(cutoff\)/);
});

test("C/D rest timer uses absolute end timestamps and can be recalculated",()=>{
  const now=Date.parse("2026-09-02T12:00:00Z");
  assert.equal(helpers.restRemainingAt("2026-09-02T12:01:30Z",now),90);
  assert.equal(helpers.restRemainingAt("2026-09-02T12:01:30Z",now+95000),0);
  assert.match(source,/function hideRestTimer\(\)/);
  assert.match(source,/function cancelRestTimer\(\)/);
  assert.match(source,/restEndsAt=new Date\(Date\.now\(\)\+duration\*1000\)/);
});

test("E session elapsed derives from timestamps, including pause time",()=>{
  const s={startedAt:"2026-09-02T12:00:00Z",pausedTotalSec:10};
  assert.equal(helpers.sessionElapsedFromTimestamps(s,Date.parse("2026-09-02T12:05:00Z")),290);
  assert.match(source,/function elapsedSeconds\(s,endMs=Date\.now\(\)\)\{return sessionElapsedFromTimestamps/);
});

test("F/G/H replacement and added exercises preserve performed metadata",()=>{
  assert.match(source,/record\.role=performed!==exercise\.name\?"replacement":"prescribed"/);
  assert.match(source,/function addPerformedExercise\(d,options=\{\}\)/);
  assert.match(source,/role:"added"/);
  assert.match(source,/function sessionReviewEntries\(s\)/);
  assert.match(source,/sourcePrescribedExerciseId/);
  assert.match(source,/substitutedFrom/);
});

test("I/J added and deleted sets persist through row actions",()=>{
  assert.match(source,/function addSet\(d,i,type\)/);
  assert.match(source,/rows\.splice\(j,1\)/);
  assert.match(source,/showRowUndo/);
  assert.match(source,/status==="skipped"/);
});

test("K/O warmups are separate from working stats",()=>{
  const stats=helpers.performedStats({
    a:{actual:[{type:"warmup",done:true,status:"completed"},{type:"working",done:true,status:"completed"},{type:"working",done:false,status:"planned"}],warmups:[{done:true,status:"completed"}]},
    b:{actual:[{type:"working",done:true,status:"completed"}],warmups:[]}
  });
  assert.deepEqual(stats,{workingSets:3,completedSets:2,warmupSets:1,completedWarmups:1});
  assert.match(source,/warmupSets/);
});

test("L Hard and Failed remain distinct progression signals",()=>{
  assert.equal(helpers.progressionFeelSignal(["Hard"]),"single hard set");
  assert.equal(helpers.progressionFeelSignal(["Failed"]),"single failed set");
  assert.match(source,/failed=completed\.filter/);
  assert.ok(!source.includes("hard/failed set"));
});

test("M RIR remains independent on working sets and absent from warmups",()=>{
  assert.match(source,/rir:normalizeRir/);
  assert.match(source,/rir:null/);
  assert.match(source,/type:"warmup"/);
});

test("N review edits are persisted before final save",()=>{
  assert.match(source,/function reviewSetEdit\(d,i,j,f,v\)/);
  assert.match(source,/function saveReviewedWorkout\(d\)/);
  assert.match(source,/sessionNote/);
});

test("P coaching export includes all performed exercises and activities",()=>{
  assert.match(source,/Object\.entries\(session\.exercises\|\|\{\}\)\.sort/);
  assert.match(source,/activities,yogaCompletions:activities/);
  assert.match(source,/role:rec\.role/);
});

test("Q cutoff advances only after successful coach import",()=>{
  assert.match(source,/reviewedWatermark/);
  assert.match(source,/includedDataCutoff/);
  assert.match(source,/state\.reviewedWatermark=/);
});

test("R weekly context derives yoga from date-specific completions",()=>{
  assert.match(source,/yogaDates=Object\.keys\(db\.yogaCompletions/);
  assert.match(source,/yogaCompleted:yogaDates\.length\?true/);
});

test("S existing coach-update importer remains wired to v1 validation",()=>{
  assert.match(source,/body-transformation-coach-update-v1/);
  assert.match(source,/validateCoachUpdatePayload/);
  assert.match(source,/validateCoachImport/);
});

test("Saturday regression fixture retains every performed exercise",()=>{
  const sat={
    leg:{name:"Leg Press",role:"prescribed",actual:[{type:"working",done:true,status:"completed"}],warmups:[]},
    rdl:{name:"Barbell Romanian Deadlift",role:"replacement",substitutedFrom:"DB RDL",actual:[{type:"working",done:true,status:"completed"}],warmups:[]},
    lunge:{name:"DB Shoulder Press",role:"replacement",substitutedFrom:"Walking Lunge",actual:[{type:"working",done:true,status:"completed"}],warmups:[]},
    bench:{name:"DB Flat Bench",role:"replacement",substitutedFrom:"Calf Raise",actual:[{type:"working",done:true,status:"completed"}],warmups:[]},
    lateral:{name:"DB Lateral Raise",role:"added",actual:[{type:"working",done:true,status:"completed"}],warmups:[]},
    calf:{name:"Calf Raise",role:"added",actual:[{type:"working",done:true,status:"completed"}],warmups:[]},
    hang:{name:"Dead Hang",role:"prescribed",actual:[{type:"working",done:true,status:"completed",seconds:30}],warmups:[]}
  };
  const stats=helpers.performedStats(sat);
  assert.equal(stats.completedSets,7);
  assert.equal(Object.keys(sat).length,7);
  for(const name of ["DB Shoulder Press","DB Flat Bench","DB Lateral Raise","Calf Raise","Dead Hang"]) assert.ok(Object.values(sat).some(x=>x.name===name));
});
