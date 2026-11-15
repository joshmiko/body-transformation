import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] || "";
const nav = html.match(/<div class="nav">([\s\S]*?)<\/div><section/)?.[1] || "";
// UI markup and code, without the embedded training program text.
const ui = html.slice(0, html.indexOf("const PROGRAM=")) + html.slice(html.indexOf(",PROGRAM_VERSION="));

const ICON_ATTRS = 'viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

test("tab bar uses the four line icons with plain labels", () => {
  const tabs = {
    nToday: ["Today", '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
    nWorkout: ["Workout", '<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/>'],
    nProgress: ["Progress", '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
    nCoach: ["Coach", '<path d="M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4"/>']
  };
  for (const [id, [label, path]] of Object.entries(tabs)) {
    const button = nav.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`))?.[0] || "";
    assert.ok(button.includes(ICON_ATTRS), id + " icon attributes");
    assert.ok(button.includes(path), id + " icon path");
    assert.ok(button.includes(`<span class="nav-label">${label}</span>`), id + " label");
  }
  assert.match(css, /\.nav button\{color:var\(--muted\);font-weight:500\}/);
  assert.match(css, /\.nav \.active\{color:var\(--beak\);font-weight:700\}/);
  assert.match(css, /\.nav \.active \.ui-icon\{stroke-width:2\}/);
});

test("profile button is a 44px round line icon with an accessible name", () => {
  const button = header.match(/<button id="bt-profile-link"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(button, /aria-label="Profile"/);
  assert.ok(button.includes(ICON_ATTRS));
  assert.ok(button.includes('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'));
  assert.match(css, /\.profile-icon,#bt-profile-link\.profile-icon\{width:44px;height:44px;min-width:44px;min-height:44px;padding:0;border-radius:50%;display:grid;place-items:center;background:var\(--surface\);border:1px solid var\(--line-strong\);color:var\(--cream\)/);
});

test("no emoji or text-symbol icons remain in the app UI", () => {
  assert.doesNotMatch(ui, /\p{Extended_Pictographic}/u, "no emoji");
  for (const symbol of ["⌂", "◉", "▥", "✦", "👤", "✓", "○", "＋", "⋯", "↻", "›"]) {
    assert.ok(!ui.includes(symbol), "symbol still used: " + symbol);
  }
  // Template icons share the same line style, and icon-only buttons have names.
  const context = {};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf("const UI_ICONS="), html.indexOf("const PROGRAM=")), context);
  for (const name of ["check", "circle", "plus", "restore", "more", "chevron"]) {
    const svg = context.uiIcon(name);
    assert.ok(svg.includes(ICON_ATTRS), name);
    assert.match(svg, /<(path|circle) /, name + " has a shape");
  }
  assert.match(html, /aria-label="\$\{off\?"Warm-up "\+\(j\+1\)\+" skipped":z\.done\?"Warm-up "\+\(j\+1\)\+" done":"Mark warm-up "\+\(j\+1\)\+" done"\}"/);
  assert.match(html, /aria-label="Workout menu"/);
  // The exercise tile already owns the .icon class; line icons must not inherit its box.
  assert.doesNotMatch(html, /<svg class="icon"/);
  assert.match(css, /\.ui-icon\{flex:none;vertical-align:middle;display:inline-block\}/);
});

test("sync status is a line under the header subtitle, hidden when synced", () => {
  assert.match(header, /<div class="sub">Train • Recover • Progress<\/div><div id="bt-sync-status" class="sync-line" role="status" aria-live="polite" data-sync-state="idle" hidden><span class="sync-dot" aria-hidden="true"><\/span><span class="sync-text"><\/span><\/div>/);
  assert.doesNotMatch(html, /position:fixed;left:50%;bottom:calc\(78px/, "the floating pill is gone");
  assert.match(css, /\.sync-line\{[^}]*color:var\(--muted\)/);
  assert.match(css, /\.sync-dot\{[^}]*background:var\(--beak\)/);
  assert.match(css, /\.sync-line\[data-sync-state="sign-in-needed"\] \.sync-dot\{background:var\(--danger\)\}/);

  const source = html.slice(html.indexOf("const btSyncIndicator = (state) => {"), html.indexOf("btSupabase.subscribeSyncStatus("));
  const text = { textContent: "" };
  const el = { hidden: true, dataset: {}, querySelector: selector => (selector === ".sync-text" ? text : null) };
  const context = { document: { getElementById: id => (id === "bt-sync-status" ? el : null) } };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.btSyncIndicator = btSyncIndicator;", context);
  const show = (state, message) => { context.btSyncIndicator({ state, message }); return { hidden: el.hidden, state: el.dataset.syncState, text: text.textContent }; };
  assert.deepEqual(show("sign-in-needed", "Sign in to sync"), { hidden: false, state: "sign-in-needed", text: "Sign in to sync" });
  assert.deepEqual(show("pending", "Saved offline — will retry"), { hidden: false, state: "pending", text: "Saved offline — will retry" });
  assert.deepEqual(show("syncing", "Syncing…"), { hidden: false, state: "syncing", text: "Syncing…" });
  assert.equal(show("synced", "Synced to cloud").hidden, true);
  assert.equal(show("idle", "").hidden, true);
});

test("Coach guidance shows plain labels, never raw field names", () => {
  const context = { escapeHtml: value => String(value ?? "") };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf("const COACH_GUIDANCE_LABELS"), html.indexOf("\n", html.indexOf("function coachTargetGuidanceMarkup(value)"))), context);
  const rows = markup => [...markup.matchAll(/<b>([^<]*)<\/b><div class=muted>([^<]*)<\/div>/g)].map(m => [m[1], m[2]]);
  const guidance = { stepsAverageTarget: 9000, zone2SessionsPerWeek: { min: 2, max: 3 }, zone2DurationMin: 30, zone2DurationMax: 40, preferredZone2Day: "Thursday", restDayWalks: 2, mobilityMinutes: { min: 10, max: 15 }, calories: 2400 };
  const markup = context.coachTargetGuidanceMarkup(guidance);
  assert.deepEqual(rows(markup), [
    ["Daily steps", "9,000"],
    ["Zone 2 sessions a week", "2–3"],
    ["Zone 2 length", "30–40 min"],
    ["Zone 2 day", "Thursday"],
    ["Rest day walks", "2"],
    ["Mobility minutes", "10–15"]
  ]);
  for (const key of Object.keys(guidance)) assert.ok(!markup.includes(key), "raw key shown: " + key);
  assert.deepEqual(rows(context.coachTargetGuidanceMarkup({ zone2DurationMax: 45 })), [["Zone 2 length", "45 min"]]);
  assert.equal(context.coachGuidanceLabel("restDayWalks"), "Rest day walks");
  assert.equal(context.coachGuidanceLabel("weeklyHRVCheck"), "Weekly HRV check");
  assert.equal(context.coachGuidanceLabel("mobility_minutes"), "Mobility minutes");
});
