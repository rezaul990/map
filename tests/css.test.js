/**
 * Stylesheet guard tests.
 *
 * These catch the classes of CSS problem that silently break layout in a browser:
 * unbalanced braces (which kill everything after them), the `inset` shorthand
 * (unsupported in older browsers, which collapses absolutely positioned boxes and
 * made the map fall back to the SVG default 300x150), undefined custom properties,
 * and the layout rules that keep the map filling its panel.
 *
 * Run with: node tests/css.test.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
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

/* --------------------------------------------------------------------- checks */

check("braces and parens are balanced", () => {
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  if (open !== close) throw new Error(`unbalanced braces: ${open} { vs ${close} }`);
  const po = (css.match(/\(/g) || []).length;
  const pc = (css.match(/\)/g) || []).length;
  if (po !== pc) throw new Error(`unbalanced parens: ${po} ( vs ${pc} )`);
});

check("no `inset` shorthand (collapses absolute boxes in older browsers)", () => {
  const offenders = css.split("\n")
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter(entry => /(^|[;{]\s*)inset\s*:/.test(entry.line));
  if (offenders.length) {
    throw new Error("use top/right/bottom/left longhands: line " + offenders.map(o => o.index).join(", "));
  }
});

check("the map host is pinned with longhand offsets", () => {
  const blocks = css.match(/\.map-svg\s*\{[^}]+\}/g) || [];
  if (!blocks.length) throw new Error(".map-svg rule missing");
  const base = blocks.find(block => /position:\s*absolute/.test(block));
  if (!base) throw new Error("no .map-svg rule with position: absolute");
  ["top", "right", "bottom", "left"].forEach(side => {
    if (!new RegExp(`(^|[;{\\s])${side}\\s*:`).test(base)) {
      throw new Error(`.map-svg has no ${side} offset: ` + base.replace(/\s+/g, " "));
    }
  });
});

check("the map svg is told to fill its host", () => {
  const block = css.match(/\.map-svg\s+svg\s*\{[^}]+\}/);
  if (!block) throw new Error(".map-svg svg rule missing");
  if (!/width:\s*100%/.test(block[0]) || !/height:\s*100%/.test(block[0])) {
    throw new Error("the svg must be 100% x 100%: " + block[0].replace(/\s+/g, " "));
  }
});

check("responsive layout blocks are present", () => {
  [["(max-height: 720px)", "short viewports"], ["(max-width: 1100px)", "stacked layout"],
    ["(max-width: 720px)", "mobile layout"], ["(prefers-reduced-motion: reduce)", "reduced motion"]]
    .forEach(([query, why]) => {
      if (css.indexOf("@media " + query) === -1) throw new Error(`missing @media ${query} (${why})`);
    });
});

check("map chrome rules exist", () => {
  [".zoom-chip", ".zoom-btn", ".zoom-level", ".map-legend", ".labels-hint",
    ".district-label.too-small", ".map-empty"].forEach(selector => {
    if (css.indexOf(selector) === -1) throw new Error("missing rule: " + selector);
  });
});

check("the single map transform wraps both shapes and names", () => {
  const map = fs.readFileSync(path.join(ROOT, "js", "map.js"), "utf8");
  if (map.indexOf("map-view") === -1) throw new Error("map.js has no map-view group");
  if (map.indexOf("map-paths") === -1 || map.indexOf("map-labels") === -1) {
    throw new Error("shapes and labels must both live inside the transformed group");
  }
});

check("every custom property used is defined", () => {
  const defined = new Set();
  (css.match(/--[a-z0-9-]+\s*:/gi) || []).forEach(decl => defined.add(decl.replace(/\s*:$/, "").trim()));
  const used = new Set((css.match(/var\(\s*(--[a-z0-9-]+)/gi) || []).map(m => m.replace(/var\(\s*/, "").trim()));
  // custom properties written from JavaScript are legitimate too
  const fromJs = fs.readFileSync(path.join(ROOT, "js", "map.js"), "utf8")
    + fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const undefinedVars = Array.from(used).filter(name => !defined.has(name) && fromJs.indexOf(name) === -1);
  if (undefinedVars.length) throw new Error("undefined custom properties: " + undefinedVars.join(", "));
});

check("assets are versioned so a deploy cannot mix old css with new js", () => {
  const version = html.match(/css\/style\.css\?v=(\d+)/);
  if (!version) throw new Error("stylesheet is not versioned");
  ["plaza", "data", "parse", "map", "app"].forEach(name => {
    if (html.indexOf(`js/${name}.js?v=${version[1]}`) === -1) {
      throw new Error(`js/${name}.js is not versioned with the same v=${version[1]}`);
    }
  });
  const fontVersions = new Set((css.match(/\.woff2\?v=(\d+)/g) || []));
  if (!fontVersions.size) throw new Error("font files are not versioned");
});

check("the document carries critical map geometry of its own", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  const critical = head.match(/<style>([\s\S]*?)<\/style>/);
  if (!critical) throw new Error("no inline critical <style> in <head>");
  const block = critical[1].replace(/\s+/g, " ");
  if (html.indexOf("<style>") < html.indexOf('href="css/style.css')) {
    throw new Error("critical styles must come after the stylesheet link so the fresh sheet still wins");
  }
  if (!/\.map-svg \{[^}]*position: absolute/.test(block)) throw new Error("critical block does not pin .map-svg");
  ["top: 40px", "right: 6px", "bottom: 6px", "left: 6px"].forEach(offset => {
    if (block.indexOf(offset) === -1) throw new Error("critical block is missing " + offset);
  });
  if (!/\.map-svg svg \{[^}]*width: 100%[^}]*height: 100%/.test(block)) {
    throw new Error("critical block does not make the svg fill its box");
  }
  if (block.indexOf("max-width: 720px") === -1 || block.indexOf("max-height: 720px") === -1) {
    throw new Error("critical block is missing the small-screen overrides");
  }
  if (block.indexOf("touch-action: none") === -1) throw new Error("critical block is missing touch-action for pinch zoom");

  // the fresh stylesheet must agree with the inline block, so a cache that does
  // hold the newest css cannot produce a different layout from the fallback
  const sheet = css.match(/\n\.map-svg \{([^}]+)\}/);
  if (!sheet) throw new Error(".map-svg base rule missing from css/style.css");
  ["top: 40px", "right: 6px", "bottom: 6px", "left: 6px"].forEach(offset => {
    if (sheet[1].replace(/\s+/g, " ").indexOf(offset) === -1) {
      throw new Error("css/style.css disagrees with the critical block: " + offset);
    }
  });
  const expanded = css.match(/\.map-expanded \.map-svg \{([^}]+)\}/);
  if (!expanded || expanded[1].indexOf("top: 44px") === -1) throw new Error("expanded offsets drifted out of css/style.css");
});

check("the layout does not depend on measurement-then-size JavaScript", () => {
  const map = fs.readFileSync(path.join(ROOT, "js", "map.js"), "utf8");
  if (/style\.width\s*=\s*[\d.]+\s*\+\s*"px"/.test(map) || /style\.height\s*=\s*[\d.]+\s*\+\s*"px"/.test(map)) {
    throw new Error("map.js must not size the svg in pixels (it created a shrink feedback loop)");
  }
  if (!/setAttribute\("width", "100%"\)/.test(map)) {
    throw new Error("the svg should carry width/height percentages itself");
  }
});

console.log(results.join("\n"));
console.log(`\n${results.length - failed}/${results.length} css checks passed`);
if (failed) process.exitCode = 1;
