import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const formStart = html.indexOf("function nutritionFormValue");
const formEnd = html.indexOf("function nutrition(){", formStart);
const rangeStart = html.indexOf("function nutritionEntryRange");
const rangeEnd = html.indexOf("function nutritionImportSheet", rangeStart);
assert.ok(formStart >= 0 && formEnd > formStart && rangeStart >= 0 && rangeEnd > rangeStart, "nutrition form helpers must exist");
const helperContext = {
  nutritionEditingId: "existing",
  nutritionNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  nutritionBounds(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return { min: value, max: value };
    if (typeof value === "object" && Number.isFinite(value.min) && Number.isFinite(value.max)) return value;
    return null;
  },
  escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  },
};
vm.createContext(helperContext);
vm.runInContext(html.slice(formStart, formEnd), helperContext);
vm.runInContext(html.slice(rangeStart, rangeEnd), helperContext);

test("food entry accepts exact calorie/protein values when optional max fields are blank", () => {
  assert.equal(helperContext.nutritionEntryRange("2150", "", "Calories"), 2150);
  assert.equal(helperContext.nutritionEntryRange("185", "", "Protein"), 185);
});

test("food entry keeps ranges, and collapses equal endpoints to exact values", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helperContext.nutritionEntryRange("2100", "2300", "Calories"))), { min: 2100, max: 2300 });
  assert.equal(helperContext.nutritionEntryRange("190", "190", "Protein"), 190);
});

test("food entry rejects missing, negative, and reversed calorie/protein ranges", () => {
  assert.throws(() => helperContext.nutritionEntryRange("", "", "Calories"), /Calories is required/);
  assert.throws(() => helperContext.nutritionEntryRange("-1", "", "Protein"), /non-negative/);
  assert.throws(() => helperContext.nutritionEntryRange("2300", "2200", "Calories"), /maximum must be at least/);
  assert.throws(() => helperContext.nutritionEntryRange("200", "-1", "Protein"), /maximum must be at least/);
});

test("editing an entry pre-fills both ends of existing calorie and protein ranges", () => {
  const entry = { id: "existing", name: "Dinner", calories: { min: 650, max: 850 }, protein: { min: 45, max: 60 }, carbs: 40, fat: 20 };
  const markup = helperContext.nutritionFoodSheet({ entries: [entry] });
  assert.match(markup, /value="650"/);
  assert.match(markup, /value="850"/);
  assert.match(markup, /value="45"/);
  assert.match(markup, /value="60"/);
  assert.match(markup, /<summary>Optional macros<\/summary>/);
  assert.match(markup, /Max \(optional\)/);
});


test("Save food persists exact values when max fields are blank", () => {
  const start = html.indexOf("function saveNutritionEntry");
  const end = html.indexOf("function editNutritionEntry", start);
  assert.ok(start >= 0 && end > start);
  const store = { entries: [] };
  const fields = { "nutrition-name": "Lunch", "nutrition-calories": "640", "nutrition-calories-max": "", "nutrition-protein": "48", "nutrition-protein-max": "", "nutrition-meal": "Lunch", "nutrition-carbs": "", "nutrition-fat": "" };
  const ctx = { document: { getElementById: (id) => fields[id] === undefined ? null : { value: fields[id] } }, nutritionNumber: helperContext.nutritionNumber, nutritionEntryRange: helperContext.nutritionEntryRange, nutritionStore: () => store, nutritionSelectedDate: "2026-09-23", nutritionEditingId: null, nutritionSheet: "food", nutritionQuickOpen: false, nutritionFocusReturnId: null, save() {}, nutrition() {} };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  ctx.saveNutritionEntry();
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].calories, 640);
  assert.equal(store.entries[0].protein, 48);
  assert.equal(store.entries[0].carbs, null);
  assert.equal(store.entries[0].fat, null);
});

test("Save food preserves existing calorie/protein ranges and unrelated entry metadata", () => {
  const start = html.indexOf("function saveNutritionEntry");
  const end = html.indexOf("function editNutritionEntry", start);
  const existing = { id: "saved", name: "Dinner", calories: { min: 700, max: 850 }, protein: { min: 50, max: 65 }, sourcePackageId: "prior-import", createdAt: "2026-09-22T20:00:00Z", customNote: "keep" };
  const store = { entries: [existing] };
  const fields = { "nutrition-name": "Dinner update", "nutrition-calories": "700", "nutrition-calories-max": "850", "nutrition-protein": "50", "nutrition-protein-max": "65", "nutrition-meal": "Dinner", "nutrition-carbs": "", "nutrition-fat": "" };
  const ctx = { document: { getElementById: (id) => fields[id] === undefined ? null : { value: fields[id] } }, nutritionNumber: helperContext.nutritionNumber, nutritionEntryRange: helperContext.nutritionEntryRange, nutritionStore: () => store, nutritionSelectedDate: "2026-09-23", nutritionEditingId: "saved", nutritionSheet: "food", nutritionQuickOpen: false, nutritionFocusReturnId: null, save() {}, nutrition() {} };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  ctx.saveNutritionEntry();
  assert.equal(store.entries.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(existing.calories)), { min: 700, max: 850 });
  assert.deepEqual(JSON.parse(JSON.stringify(existing.protein)), { min: 50, max: 65 });
  assert.equal(existing.sourcePackageId, "prior-import");
  assert.equal(existing.createdAt, "2026-09-22T20:00:00Z");
  assert.equal(existing.customNote, "keep");
  assert.equal(existing.name, "Dinner update");
});

test("Quick add uses an accessible sheet and keeps Edit/Add actions available", () => {
  const start = html.indexOf("function nutritionQuickSheet");
  const end = html.indexOf("function nutritionPresetSheet", start);
  assert.ok(start >= 0 && end > start);
  const quickSheet = html.slice(start, end);
  assert.match(quickSheet, /role="dialog" aria-modal="true"/);
  assert.match(quickSheet, /aria-label="Close Quick add"/);
  assert.match(quickSheet, /editNutritionPreset/);
  assert.match(quickSheet, /quickAddNutrition/);
  assert.match(html, /nutritionSheet==="quick"\?nutritionQuickSheet\(store\)/);
});

test("quick-add preset saves one entry, closes the sheet, and rerenders entries", () => {
  const start = html.indexOf("function quickAddNutrition");
  const end = html.indexOf("function editNutritionTargets", start);
  assert.ok(start >= 0 && end > start);
  const store = { presets: [{ id: "shake", name: "Protein shake", calories: 120, protein: 24, carbs: 3, fat: 2 }], entries: [] };
  let saves = 0;
  let renders = 0;
  const ctx = {
    nutritionStore: () => store,
    nutritionNumber: helperContext.nutritionNumber,
    nutritionSelectedDate: "2026-09-23",
    nutritionSheet: "quick",
    nutritionQuickOpen: true,
    nutritionFocusReturnId: null,
    save: () => saves++,
    nutrition: () => renders++,
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  ctx.quickAddNutrition("shake");
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].date, "2026-09-23");
  assert.equal(store.entries[0].calories, 120);
  assert.equal(store.entries[0].protein, 24);
  assert.equal(ctx.nutritionSheet, null);
  assert.equal(ctx.nutritionQuickOpen, false);
  assert.equal(saves, 1);
  assert.equal(renders, 1);
});

test("Nutrition imports are under Advanced / backup and same-page renders preserve scroll", () => {
  const renderStart = html.indexOf("function nutrition(){");
  const renderEnd = html.indexOf("function toggleNutritionQuick", renderStart);
  const render = html.slice(renderStart, renderEnd);
  assert.match(render, /<h3>Weekly adherence<\/h3>[\s\S]*<summary>Advanced \/ backup<\/summary>/);
  assert.match(render, /aria-haspopup="dialog"/);
  assert.match(render, /resetScroll=!hadNutrition\|\|nutritionResetScroll/);
  assert.match(render, /nutritionResetScroll=true;nutrition\(\)/);
  assert.match(render, /else window\.scrollTo\(0,scrollTop\)/);
  assert.doesNotMatch(render, /window\.scrollTo\(0,0\);document\.body/);
});
