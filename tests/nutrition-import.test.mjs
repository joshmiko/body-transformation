import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("function normalizeNutritionImportNumber");
const end = html.indexOf("function nutritionImportSheet", start);
assert.ok(start >= 0 && end > start, "nutrition import validator must exist");

const context = { nutritionStore: () => ({ entries: [] }) };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const validPackage = () => ({
  schema: "body-transformation-nutrition-import-v1",
  packageId: "package-test",
  generatedAt: "2026-09-04T12:00:00Z",
  timezone: "America/New_York",
  days: [{
    date: "2026-09-04",
    entries: [
      { sourceEntryId: "a", name: "Breakfast", calories: 300, protein: 20, carbs: null, fat: null, estimated: true },
      { sourceEntryId: "b", name: "Shake", calories: 120, protein: 24, meal: "Shake" },
    ],
  }],
});

test("valid nutrition package validates and derives preview totals", () => {
  const pkg = context.validateNutritionImportPackage(JSON.stringify(validPackage()));
  assert.equal(pkg.entries.length, 2);
  const preview = context.nutritionImportPreview(pkg);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.totals)), { calories: 420, protein: 44, estimated: 1 });
  assert.equal(preview.duplicates.length, 0);
});

test("malformed, wrong-schema, negative, invalid-meal, and duplicate packages reject", () => {
  assert.throws(() => context.validateNutritionImportPackage("{"), /valid JSON/);
  const base = validPackage();
  base.schema = "wrong";
  assert.throws(() => context.validateNutritionImportPackage(JSON.stringify(base)), /not a Nutrition Import/);
  const negative = validPackage();
  negative.days[0].entries[0].calories = -1;
  assert.throws(() => context.validateNutritionImportPackage(JSON.stringify(negative)), /finite non-negative/);
  const meal = validPackage();
  meal.days[0].entries[0].meal = "Brunch";
  assert.throws(() => context.validateNutritionImportPackage(JSON.stringify(meal)), /Meal must be/);
  const duplicate = validPackage();
  duplicate.days[0].entries[1].sourceEntryId = "a";
  assert.throws(() => context.validateNutritionImportPackage(JSON.stringify(duplicate)), /unique/);
});

test("estimated values and duplicate source IDs are preserved and identified", () => {
  const pkg = context.validateNutritionImportPackage(JSON.stringify(validPackage()));
  context.nutritionStore = () => ({ entries: [{ sourcePackageId: "package-test", sourceEntryId: "a" }] });
  const preview = context.nutritionImportPreview(pkg);
  assert.equal(preview.duplicates.length, 1);
  assert.equal(pkg.entries[0].estimated, true);
});

test("import storage and mobile handoff hooks are present", () => {
  assert.match(html, /sourcePackageId/);
  assert.match(html, /sourceEntryId/);
  assert.match(html, /out\.nutrition\.imports/);
  assert.match(html, /Import from ChatGPT/);
  assert.match(html, /Import entries/);
});


test("nutrition package v1 with dailyLogs converts only exact itemized meals", () => {
  const packageV1 = {
    schema: "body-transformation-nutrition-package-v1",
    packageId: "nutrition_2026-09-03",
    timezone: "America/New_York",
    dailyLogs: [
      {
        date: "2026-09-02",
        totals: { calories: { min: 2000, max: 2400 }, protein_g: { min: 150, max: 200 } },
        dataQuality: { estimated: true, notes: "Range-only summary" },
      },
      {
        date: "2026-09-03",
        meals: [
          { name: "Breakfast", calories: 465, protein_g: 29 },
          { name: "Protein shake", calories: 120, protein_g: 24 },
        ],
        dataQuality: { estimated: true, notes: "Some values estimated" },
      },
    ],
  };
  const pkg = context.validateNutritionImportPackage(JSON.stringify(packageV1));
  assert.equal(pkg.entries.length, 2);
  assert.equal(pkg.days.length, 1);
  assert.equal(pkg.entries[0].date, "2026-09-03");
  assert.equal(pkg.entries[1].meal, "Shake");
  assert.equal(pkg.entries[0].estimated, true);
  assert.equal(pkg.entries[0].note, "Some values estimated");
  assert.equal(pkg.schema, "body-transformation-nutrition-import-v1");
});
