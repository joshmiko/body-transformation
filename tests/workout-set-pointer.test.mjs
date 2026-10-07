import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bindSwipeSource = indexHtml.match(/function bindSwipeRows\(\)\{[\s\S]*?\}(?=\s*function edit\()/)?.[0];
assert.ok(bindSwipeSource, "bindSwipeRows should exist before the set edit handler");

function bindFakeRow() {
  const listeners = {};
  const captures = [];
  const classes = new Set();
  const row = {
    dataset: {},
    addEventListener(type, callback) { listeners[type] = callback; },
    setPointerCapture(pointerId) { captures.push(pointerId); },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  const bind = new Function("document", `${bindSwipeSource}; return bindSwipeRows`)({ querySelectorAll: () => [row] });
  bind();
  return { listeners, row, captures };
}

test("ordinary pointer tap does not capture the pointer from a nested set button", () => {
  const { listeners, row, captures } = bindFakeRow();
  const button = { name: "check-button" };
  listeners.pointerdown({ clientX: 100, clientY: 40, pointerId: 7, target: button });
  assert.deepEqual(captures, [], "pointer capture must not happen on pointerdown");
  listeners.pointermove({ clientX: 104, clientY: 41, pointerId: 7, cancelable: true, preventDefault() {} });
  listeners.pointerup({ clientX: 104, clientY: 41, pointerId: 7, target: button });
  assert.deepEqual(captures, []);
  assert.equal(row.dataset.swipeGesture, undefined);
  assert.equal(row.classList.contains("swipe-open"), false);
});

test("horizontal pointer drag captures only after recognition and preserves swipe behavior", () => {
  const { listeners, row, captures } = bindFakeRow();
  listeners.pointerdown({ clientX: 100, clientY: 40, pointerId: 9 });
  assert.deepEqual(captures, []);
  listeners.pointermove({ clientX: 84, clientY: 42, pointerId: 9, cancelable: true, preventDefault() {} });
  assert.deepEqual(captures, [9], "capture starts when the gesture crosses the horizontal threshold");
  let prevented = false;
  listeners.pointermove({ clientX: 45, clientY: 42, pointerId: 9, cancelable: true, preventDefault() { prevented = true; } });
  listeners.pointerup({ clientX: 45, clientY: 42, pointerId: 9 });
  assert.equal(prevented, true);
  assert.equal(row.classList.contains("swipe-open"), true);
  assert.equal(row.dataset.swipeGesture, "1");
});

test("pointer cancel clears an incomplete gesture without opening swipe actions", () => {
  const { listeners, row, captures } = bindFakeRow();
  listeners.pointerdown({ clientX: 100, clientY: 40, pointerId: 12 });
  listeners.pointercancel({ pointerId: 12 });
  listeners.pointerup({ clientX: 35, clientY: 40, pointerId: 12 });
  assert.deepEqual(captures, []);
  assert.equal(row.dataset.swipeGesture, undefined);
  assert.equal(row.classList.contains("swipe-open"), false);
});
