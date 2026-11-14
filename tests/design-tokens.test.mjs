import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const html = read("index.html");
const consent = read("oauth/consent.html");
const manifest = JSON.parse(read("manifest.json"));
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

const TOKENS = {
  ground: "#0E0E0F", surface: "#1A1A1C", line: "#343436", "line-strong": "#6B6860",
  cream: "#E6D9A8", muted: "#A8A39A", red: "#B81C28", beak: "#F2A41E", danger: "#FF6B5E"
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("the app and the consent page define the Shift tokens exactly, in one dark theme", () => {
  for (const [source, name] of [[css, "index.html"], [consent, "consent.html"]]) {
    for (const [token, value] of Object.entries(TOKENS)) {
      assert.match(source, new RegExp(`--${token}:${value};?`), `${name} --${token}`);
    }
    assert.doesNotMatch(source, /prefers-color-scheme/, name + " has one theme");
    assert.match(source, /color-scheme:dark/);
  }
  assert.doesNotMatch(css, /--(purple|pink|orange):/, "removed accents stay removed");
  assert.doesNotMatch(html, /var\(--(purple|pink|orange)\)/);
});

test("text colours meet 4.5:1 on the backgrounds they are used on", () => {
  const pairs = [
    ["cream", "ground"], ["cream", "surface"], ["cream", "red"],
    ["muted", "ground"], ["muted", "surface"],
    ["beak", "ground"], ["beak", "surface"],
    ["danger", "ground"], ["danger", "surface"],
    ["ground", "cream"]
  ];
  for (const [fg, bg] of pairs) {
    assert.ok(contrast(TOKENS[fg], TOKENS[bg]) >= 4.5, `${fg} on ${bg} is ${contrast(TOKENS[fg], TOKENS[bg]).toFixed(2)}:1`);
  }
  // Red is a fill only: its text is always cream.
  assert.ok(contrast(TOKENS.beak, TOKENS.red) < 4.5 && contrast(TOKENS.muted, TOKENS.red) < 4.5, "these pairings must never be used");
  assert.doesNotMatch(css, /(^|[;{])\s*color:\s*var\(--red\)/m, "red is never a text colour");
});

test("surfaces are flat: no shadows, blur or gradients", () => {
  for (const source of [css, consent]) {
    assert.doesNotMatch(source, /gradient\(/);
  }
  assert.match(css, /\*\{box-shadow:none!important;text-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important/);
  assert.doesNotMatch(consent, /box-shadow|backdrop-filter/);
});

test("display type loads with an offline fallback", () => {
  for (const source of [html, consent]) {
    assert.match(source, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Big\+Shoulders\+Display:wght@700;800&display=swap">/);
    assert.match(source, /--display:"Big Shoulders Display","Arial Narrow","Helvetica Neue",sans-serif/);
  }
  assert.match(css, /\.brand\{font-family:var\(--display\);font-weight:800;[^}]*text-transform:uppercase/);
  assert.match(css, /\.ename,\.review-exercise h3\{font-family:var\(--display\);font-weight:800;text-transform:uppercase;letter-spacing:\.5px\}/);
});

test("shape and selection rules: radii, tap sizes, cream for selected choices", () => {
  assert.match(css, /\.card,\.metric,\.dash-tile\{border-radius:16px\}/);
  assert.match(css, /\.hero,\.exercise,\.dashboard-week,\.timerbox,\.cancel-workout-sheet,\.bt-login-card\{border-radius:20px\}/);
  assert.match(css, /\.feel button,\.day,\.tag,\.pill,\.chip\{border-radius:12px\}/);
  assert.match(css, /button\{min-height:44px\}/);
  assert.match(css, /\.primary\{min-height:56px;/);
  assert.match(css, /\.srow input,\.review-set \.review-weight,\.review-set \.review-reps\{min-height:56px;/);
  assert.match(css, /\.feel button\.sel\{background:var\(--cream\)!important;border-color:var\(--cream\)!important;color:var\(--ground\)!important\}/);
  assert.match(css, /\.day\.sel\{background:var\(--red\)!important;color:var\(--cream\)!important\}/);
});

test("browser chrome colours match the ground colour", () => {
  assert.match(html, /<meta name="theme-color" content="#0E0E0F">/);
  assert.equal(manifest.theme_color, "#0E0E0F");
  assert.equal(manifest.background_color, "#0E0E0F");
});
