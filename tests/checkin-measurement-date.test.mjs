import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("function checkinMeasurementDate");
const end = html.indexOf("function dashboardData", start);
assert.ok(start >= 0 && end > start, "measurement-date helpers must exist");
const context = {
  progressWeekKey(value) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    return date.toISOString().slice(0, 10);
  }
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const olderMeasurement = {
  id: "coach-backdated",
  date: "2026-09-14",
  createdAt: "2026-09-23T12:00:00.000Z",
  weight: 207
};
const currentMeasurement = {
  id: "current",
  date: "2026-09-21",
  createdAt: "2026-09-21T12:00:00.000Z",
  weight: 205
};

test("backdated coach weigh-in cannot become latest weight by insertion time", () => {
  const sorted = context.sortCheckinsByMeasurementDate([currentMeasurement, olderMeasurement]);
  assert.equal(sorted[0].id, "coach-backdated");
  assert.equal(sorted[1].id, "current");
  assert.equal(context.latestCheckinByMeasurementDate([currentMeasurement, olderMeasurement], x => Number.isFinite(Number(x.weight))).id, "current");
  assert.equal(context.checkinMeasurementDate(olderMeasurement), "2026-09-14");
});

test("rolling weight trend window uses measurement date, not creation date", () => {
  const startDate = new Date("2026-09-17T00:00:00");
  const endDate = new Date("2026-09-23T23:59:59");
  const inWindow = context.checkinsByMeasurementWindow([olderMeasurement, currentMeasurement], startDate, endDate);
  assert.equal(inWindow.length, 1);
  assert.equal(inWindow[0].id, "current");
});

test("weekly progress groups a backdated weigh-in into its measurement week", () => {
  const groups = context.checkinsByMeasurementWeek([currentMeasurement, olderMeasurement]);
  assert.deepEqual(Object.keys(groups).sort(), ["2026-09-14", "2026-09-21"]);
  assert.equal(groups["2026-09-14"][0].id, "coach-backdated");
  assert.equal(groups["2026-09-21"][0].id, "current");
});

test("invalid or missing measurement date falls back to valid creation time", () => {
  assert.equal(context.checkinMeasurementDate({ date: "2026-02-30", createdAt: "2026-09-22T20:00:00.000Z" }), "2026-09-22");
  assert.equal(context.checkinMeasurementDate({ date: "not-a-date", createdAt: "invalid" }), null);
});
