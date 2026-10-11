/**
 * Font guard tests.
 *
 * The app ships self-hosted Bengali + Latin fonts (vendor/fonts). Any UI string
 * using a character outside those subsets would fall back to another font — and
 * because Bengali shaping is damaged by mixed fallback runs, that used to mangle
 * whole labels (e.g. "≤" is not in Hind Siliguri's Bengali/Latin subsets).
 *
 * Run with: node tests/fonts.test.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const results = [];
let failed = 0;

function check(name, fn) {
  try {
    fn();
    results.push("  ok   " + name);
  } catch (err) {
    results.push("  FAIL " + name + " -> " + err.message);
    failed++;
  }
}

const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const jsFiles = ["js/app.js", "js/map.js", "js/parse.js", "js/data.js"];

/** Coverage promised by the @font-face unicode-ranges. */
function coveredRanges() {
  const ranges = [];
  const blocks = css.match(/@font-face\s*\{[^}]+\}/g) || [];
  blocks.forEach(block => {
    const declared = block.match(/unicode-range:\s*([^;]+);/);
    if (!declared) return;
    declared[1].split(",").forEach(part => {
      const value = part.trim().replace(/U\+/i, "");
      if (!value) return;
      if (value.indexOf("-") !== -1) {
        const [from, to] = value.split("-");
        ranges.push([parseInt(from, 16), parseInt(to, 16)]);
      } else {
        const single = parseInt(value, 16);
        ranges.push([single, single]);
      }
    });
  });
  return ranges;
}

const RANGES = coveredRanges();
const IGNORED = new Set(["\u200c", "\u200d", "\u00a0", "\ufeff"]);
/** Punctuation that is code, not UI copy. */
const IGNORED_CHARS = new Set(["\u201c", "\u201d", "\u2018", "\u2019"]);

const isCovered = ch => {
  const code = ch.codePointAt(0);
  return RANGES.some(([from, to]) => code >= from && code <= to);
};

/** Non-ASCII characters that appear inside quoted strings (i.e. user visible). */
function uiCharacters(file, source) {
  const found = new Map();
  const stringLiterals = source.match(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
  stringLiterals.forEach(literal => {
    Array.from(literal).forEach(ch => {
      if (ch.codePointAt(0) < 128) return;
      if (IGNORED.has(ch) || IGNORED_CHARS.has(ch)) return;
      if (isCovered(ch)) return;
      if (!found.has(ch)) found.set(ch, file);
    });
  });
  return found;
}

/* --------------------------------------------------------------------- checks */

check("fonts are self-hosted and every referenced file exists", () => {
  assert.ok(/@font-face/.test(css), "no @font-face rules in the stylesheet");
  const urls = (css.match(/url\('([^']*hind-siliguri[^']*)'\)/g) || [])
    .map(value => value.match(/url\('([^']+)'\)/)[1]);
  assert.ok(urls.length >= 6, "expected bengali + latin rules, found " + urls.length);
  urls.forEach(url => {
    const file = path.join(ROOT, url.replace("../", ""));
    assert.ok(fs.existsSync(file), "missing font file: " + url);
    assert.ok(fs.statSync(file).size > 1000, "suspiciously small font file: " + url);
  });
});

check("no external font CDN is requested", () => {
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), "index.html still loads Google Fonts");
  assert.ok(!/fonts\.googleapis/.test(css), "stylesheet still loads Google Fonts");
  assert.ok(/preload[^>]*hind-siliguri-400-bengali\.woff2/.test(html), "primary font is not preloaded");
});

check("the font stack prefers the vendored family, then system Bengali fonts", () => {
  const stack = css.match(/--font:\s*([^;]+);/)[1];
  assert.ok(/^'Hind Siliguri'/.test(stack.trim()), "vendored family should come first: " + stack);
  assert.ok(/Noto Sans Bengali|Nirmala UI|Vrinda/.test(stack), "no system Bengali fallback: " + stack);
});

check("every UI string only uses characters covered by the vendored fonts", () => {
  const offenders = new Map();
  [...jsFiles.map(file => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]), ["index.html", html]]
    .forEach(([file, source]) => {
      uiCharacters(file, source).forEach((owner, ch) => {
        offenders.set(ch, (offenders.get(ch) || owner) + " (U+" + ch.codePointAt(0).toString(16).toUpperCase() + ")");
      });
    });
  assert.strictEqual(offenders.size, 0,
    "uncovered characters: " + Array.from(offenders.entries()).map(([ch, where]) => `${ch} ${where}`).join(", "));
});

check("map typography uses the vendored family explicitly", () => {
  const map = fs.readFileSync(path.join(ROOT, "js/map.js"), "utf8");
  assert.ok(/const FONT = "'Hind Siliguri'/.test(map), "map.js font constant");
  assert.ok(/font-family", FONT/.test(map), "exported text nodes set the family explicitly");
  assert.ok(/fontFamily = FONT/.test(map), "district labels set the family explicitly");
  assert.ok(/setAttribute\("font-family", FONT\)/.test(map), "export svg root and text nodes set the family");
});

console.log(results.join("\n"));
console.log(`\n${results.length - failed}/${results.length} font checks passed`);
if (failed) process.exitCode = 1;
