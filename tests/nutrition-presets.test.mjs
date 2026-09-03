import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("function defaultNutritionPresets");
const end = html.indexOf("function migrateDb", start);
assert.ok(start >= 0 && end > start, "nutrition preset migration helpers must exist");

const context = {
  numericOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const legacyPresets = () => [
  { id: "breakfast", name: "Usual breakfast", calories: null, protein: null, carbs: null, fat: null },
  { id: "shake", name: "Usual shake", calories: null, protein: null, carbs: null, fat: null },
  { id: "lunch", name: "Usual lunch", calories: null, protein: null, carbs: null, fat: null },
  { id: "dinner", name: "Usual dinner", calories: null, protein: null, carbs: null, fat: null },
  { id: "snacks", name: "Usual snacks", calories: null, protein: null, carbs: null, fat: null },
];

test("verified nutrition defaults contain the six approved presets", () => {
  const presets = context.defaultNutritionPresets();
  assert.equal(presets.length, 6);
  assert.deepEqual(
    JSON.parse(JSON.stringify(presets)),
    [
      { id: "breakfast", name: "Full yogurt bowl", calories: 546, protein: 61.5, carbs: 49, fat: 13.5 },
      { id: "shake", name: "ON whey — 1 scoop", calories: 120, protein: 24, carbs: 3, fat: 2 },
      { id: "lunch", name: "Chicken salad (estimated)", calories: 630, protein: 50, carbs: 50, fat: 25 },
      { id: "dinner", name: "Beef round + pita + naan", calories: 875, protein: 100, carbs: 53, fat: 29 },
      { id: "snacks", name: "Apple + 1 tbsp peanut butter", calories: 190, protein: 4, carbs: 25, fat: 8 },
      { id: "quest-bar", name: "Quest Cookies & Cream bar", calories: 190, protein: 20, carbs: null, fat: null },
    ],
  );
});

test("untouched legacy placeholders upgrade and migration is idempotent", () => {
  const once = context.mergeNutritionPresets(legacyPresets());
  assert.equal(once.length, 6);
  assert.equal(once.find((preset) => preset.id === "breakfast").calories, 546);
  const snapshot = JSON.parse(JSON.stringify(once));
  const twice = context.mergeNutritionPresets(once);
  assert.deepEqual(JSON.parse(JSON.stringify(twice)), snapshot);
});

test("customized presets are preserved while missing defaults are added", () => {
  const customized = [
    { id: "breakfast", name: "Josh's custom breakfast", calories: 700, protein: 45, carbs: 70, fat: 20 },
    { id: "quest-bar", name: "Custom Quest label", calories: 200, protein: 21, carbs: 22, fat: 8 },
  ];
  const result = context.mergeNutritionPresets(customized);
  assert.deepEqual(result.find((preset) => preset.id === "breakfast"), customized[0]);
  assert.deepEqual(result.find((preset) => preset.id === "quest-bar"), customized[1]);
  assert.equal(new Set(result.map((preset) => preset.id)).size, result.length);
  assert.equal(result.length, 6);
});
