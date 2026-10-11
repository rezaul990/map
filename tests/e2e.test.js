/**
 * End-to-end UI test.
 *
 * Serves the repo over HTTP, loads index.html in jsdom, pushes a generated
 * Excel report through the upload pipeline and asserts the whole UI reacts.
 *
 * Run with:  npm install && node tests/e2e.test.js
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");

let JSDOM;
let VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (err) {
  console.error("jsdom is required for the e2e test — run `npm install` first.");
  process.exit(1);
}
const XLSX = require(path.join(ROOT, "vendor/xlsx.full.min.js"));

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json", ".svg": "image/svg+xml"
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Build a workbook shaped like the real "hireTargetAccAll" export. */
function buildWorkbook() {
  const plazaMap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/plaza-district.json"), "utf8"));
  const header = new Array(26).fill("");
  header[0] = "S/N"; header[1] = "Division"; header[2] = "Area"; header[3] = "Plaza Code"; header[7] = "Plaza";
  header[9] = "Collectable Acc Qty"; header[10] = "Collected Acc Qty"; header[11] = "Collectable Vs. Collected Acc Qty (%)";
  header[13] = "Collectable Amt."; header[16] = "Collected Acc Amt."; header[18] = "Advance"; header[19] = "Total Collection";
  header[20] = "Collectable Vs. Collected Amt. (%)"; header[21] = "Prev. Overdue"; header[23] = "Running Overdue";
  header[25] = "Overdue Increase/(Decrease)";

  const rows = [[], [], header];
  plazaMap.filter((_, i) => i % 6 === 0).forEach((plaza, i) => {
    const row = new Array(26).fill("");
    const qty = 45 + ((i * 7) % 55);
    row[1] = plaza.division; row[2] = plaza.area; row[7] = plaza.plaza;
    row[9] = 1000 + i; row[10] = 900 + i; row[11] = qty; row[13] = 500000 + i * 100;
    row[16] = 400000 + i * 100; row[19] = 2500; row[20] = qty - 3;
    row[21] = 10000; row[23] = 10000 + (i % 20) * 100 - 300; row[25] = (i % 20) * 100 - 300;
    rows.push(row);
  });
  rows.push(["", "Total", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Report"], ["cover sheet"]]), "Cover");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "S N Division Area Plaza");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const pending = [];
function check(name, fn) {
  const entry = { name, ok: true, message: "" };
  results.push(entry);
  try {
    const outcome = fn();
    if (outcome && typeof outcome.then === "function") {
      // async check: keep the order, settle it before the summary is printed
      pending.push(outcome.then(
        () => entry,
        err => {
          entry.ok = false;
          entry.message = err.message;
          process.exitCode = 1;
          return entry;
        }
      ));
    }
  } catch (err) {
    entry.ok = false;
    entry.message = err.message;
    process.exitCode = 1;
  }
  return entry;
}

function report() {
  const lines = results.map(entry => entry.ok
    ? "  ok   " + entry.name
    : "  FAIL " + entry.name + " -> " + entry.message);
  console.log(lines.join("\n"));
  const passed = results.filter(entry => entry.ok).length;
  console.log(`\n${passed}/${results.length} e2e checks passed`);
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const geo = JSON.parse(fs.readFileSync(path.join(ROOT, "data/bangladesh.geojson"), "utf8"));

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});

  const dom = await JSDOM.fromURL(base + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = async url => {
        const target = String(url);
        if (target.includes("bangladesh.geojson")) {
          return { ok: true, status: 200, json: async () => geo };
        }
        const file = path.join(ROOT, target.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, ""));
        if (!fs.existsSync(file)) throw new Error("unexpected fetch " + target);
        const buffer = fs.readFileSync(file);
        return {
          ok: true,
          status: 200,
          async text() { return buffer.toString("utf8"); },
          async arrayBuffer() {
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          }
        };
      };
      window.confirm = () => true;
      window.__blobs = [];
      window.URL.createObjectURL = blob => { window.__blobs.push(blob); return "blob:mock/" + window.__blobs.length; };
      window.URL.revokeObjectURL = () => {};
    }
  });

  const { window } = dom;
  const doc = window.document;
  await sleep(800);
  const App = window.eval("App"); // declared with const in a classic script
  const blobText = index => new Promise((resolve, reject) => {
    const blob = window.__blobs[index];
    if (!blob) { reject(new Error("no exported blob at index " + index)); return; }
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("could not read the blob"));
    reader.readAsText(blob);
  });

  /* ---------------------------------------------------------------- checks */

  check("boots and renders 64 districts with labels", () => {
    assert.strictEqual(doc.querySelectorAll("#map svg path.map-path").length, 64);
    assert.strictEqual(doc.querySelectorAll(".district-label").length, 64);
    assert.ok(doc.querySelectorAll("#kpis .kpi").length >= 5);
  });

  check("shows the empty state before any upload", () => {
    assert.strictEqual(doc.getElementById("mapEmpty").hidden, false);
    assert.strictEqual(doc.getElementById("exportBtn").disabled, true);
  });

  const buffer = buildWorkbook().toString("base64");
  window.eval(`window.__buf=(function(){var b=atob(${JSON.stringify(buffer)});var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u.buffer;})()`);
  const parsed = await App.internals.ingestBuffer(window.__buf, "hireTargetAccAll.xlsx");
  await sleep(60);

  check("parses the report sheet even when a cover sheet is first", () => {
    const state = App.internals.state;
    assert.ok(parsed.entries.length > 100, "entries: " + parsed.entries.length);
    assert.ok(Object.keys(state.stats).length > 40, "districts: " + Object.keys(state.stats).length);
    assert.strictEqual(state.unmatched.length, 0, "all plazas mapped");
  });

  check("status line and KPI cards reflect the upload", () => {
    const status = doc.getElementById("uploadStatus").textContent;
    assert.ok(status.includes(String(parsed.entries.length)), "status: " + status);
    const values = Array.from(doc.querySelectorAll(".kpi-value")).map(el => el.textContent);
    assert.ok(values.includes(new Intl.NumberFormat("en-IN").format(parsed.entries.length)), "kpi: " + values.join(" | "));
  });

  check("legend band counts add up to all 64 districts", () => {
    const counts = Array.from(doc.querySelectorAll("#legend .legend-count")).map(el => Number(el.textContent));
    assert.strictEqual(counts.length, 5);
    assert.strictEqual(counts.reduce((a, b) => a + b, 0), 64);
  });

  check("sidebar lists all 64 districts, most with values", () => {
    const rows = doc.querySelectorAll("#locationList .location-item");
    assert.strictEqual(rows.length, 64);
    const valued = Array.from(rows).filter(row => !row.querySelector(".location-value").classList.contains("dim"));
    assert.ok(valued.length > 40, "valued rows: " + valued.length);
    assert.ok(doc.getElementById("listCount").textContent.includes("64"));
  });

  check("hovering a list row highlights that district on the map", () => {
    const row = doc.querySelector("#locationList .location-item");
    row.dispatchEvent(new window.MouseEvent("pointerenter", { bubbles: true }));
    const hovered = doc.querySelectorAll("#map path.map-path.focused");
    assert.ok(hovered.length >= 1, "focused paths: " + hovered.length);
    row.dispatchEvent(new window.MouseEvent("pointerleave", { bubbles: true }));
  });

  check("clicking a district opens the detail drawer with plaza rows", () => {
    const target = Array.from(doc.querySelectorAll("#locationList .location-item"))
      .find(el => !el.querySelector(".location-value").classList.contains("dim"));
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(doc.getElementById("drawer").classList.contains("open"));
    assert.ok(doc.querySelectorAll("#drawerList .drawer-row").length >= 1);
    assert.ok(doc.getElementById("drawerStats").children.length >= 4);
    assert.ok(doc.getElementById("drawerTotals").textContent.includes("Collectable Amt."));
    assert.strictEqual(doc.querySelectorAll("#drawerList .drawer-table-head span").length, 4, "plaza table header");
    const cells = doc.querySelectorAll("#drawerList .drawer-row .drawer-cell");
    assert.ok(cells.length >= 3, "plaza table cells: " + cells.length);
    assert.strictEqual(doc.querySelectorAll("#map path.map-path.selected").length, 1);
    assert.ok(doc.querySelectorAll("#map path.map-path.dimmed").length > 50);
    doc.getElementById("drawerClose").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("drawer").classList.contains("open"), false);
  });

  const legendCounts = () => Array.from(doc.querySelectorAll("#legend .legend-count")).map(el => Number(el.textContent));

  check("metric tabs switch legend, hint and tooltip data", () => {
    const tab = doc.querySelector('.metric-tab[data-metric="overdueChange"]');
    tab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(tab.classList.contains("active"));
    // adaptive scale: 3 overdue bands + "no data"
    assert.strictEqual(doc.querySelectorAll("#legend .legend-item").length, 4);
    assert.strictEqual(legendCounts().reduce((a, b) => a + b, 0), 64);
    assert.ok(doc.getElementById("metricHint").textContent.length > 10);
    assert.ok(doc.getElementById("metricHint").textContent.includes("তুলনামূলক"));
    doc.querySelector('.metric-tab[data-metric="collectedQty"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // adaptive scale: 4 percentage bands + "no data"
    assert.strictEqual(doc.querySelectorAll("#legend .legend-item").length, 5);
    assert.strictEqual(App.internals.state.metric, "collectedQty");
  });

  check("both percentage metrics carry data (regression: amtPct was not parsed)", () => {
    const stats = App.internals.state.stats;
    const withQty = Object.keys(stats).filter(shape => App.internals.state.stats[shape].ratioQtyPct !== null);
    const withAmt = Object.keys(stats).filter(shape => App.internals.state.stats[shape].ratioAmtPct !== null);
    assert.ok(withQty.length > 10, "qty districts: " + withQty.length);
    assert.ok(withAmt.length > 10, "amt districts: " + withAmt.length);
    assert.strictEqual(withQty.length, withAmt.length);
  });

  check("scale picker switches between adaptive and fixed thresholds", () => {
    const scale = doc.getElementById("scaleSelect");
    scale.value = "fixed";
    scale.dispatchEvent(new window.Event("change", { bubbles: true }));
    const labels = Array.from(doc.querySelectorAll("#legend .legend-label")).map(el => el.textContent);
    assert.ok(labels.some(text => text.includes("70 – 79.99%")), "fixed labels: " + labels.join(" | "));
    assert.strictEqual(legendCounts().reduce((a, b) => a + b, 0), 64);
    scale.value = "relative";
    scale.dispatchEvent(new window.Event("change", { bubbles: true }));
    const adaptive = Array.from(doc.querySelectorAll("#legend .legend-label")).map(el => el.textContent);
    assert.ok(adaptive.some(text => text.includes("২৫%")), "adaptive labels: " + adaptive.join(" | "));
  });

  check("search matches English, Bengali and plaza names", () => {
    const search = doc.getElementById("searchInput");
    const type = value => { search.value = value; search.dispatchEvent(new window.Event("input", { bubbles: true })); };
    type("chatto");
    assert.strictEqual(doc.querySelectorAll("#locationList .location-item").length, 1);
    type("ঢাকা");
    assert.ok(doc.querySelector('#locationList .location-item .location-name').textContent.includes("ঢাকা"));
    type("zzz-no-such-district");
    assert.ok(doc.querySelector("#locationList .list-empty"));
    type("");
    assert.strictEqual(doc.querySelectorAll("#locationList .location-item").length, 64);
  });

  check("sorting by value puts the best district first", () => {
    const sort = doc.getElementById("sortSelect");
    sort.value = "value-desc";
    sort.dispatchEvent(new window.Event("change", { bubbles: true }));
    const values = Array.from(doc.querySelectorAll("#locationList .location-value"))
      .map(el => el.textContent)
      .filter(text => /%$/.test(text))
      .map(parseFloat);
    assert.ok(values.length > 10, "valued rows: " + values.length);
    for (let i = 1; i < values.length; i++) assert.ok(values[i - 1] >= values[i], "descending at " + i);
    // districts without data must sink to the bottom
    const lastRow = Array.from(doc.querySelectorAll("#locationList .location-item")).pop();
    assert.ok(lastRow.querySelector(".location-value").classList.contains("dim"));
  });

  check("district filter focuses one district without hiding the rest", () => {
    const select = doc.getElementById("districtFilter");
    select.value = "Dhaka";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.strictEqual(doc.querySelectorAll("#map path.map-path").length, 64);
    assert.strictEqual(doc.querySelectorAll("#map path.map-path.selected").length, 1);
    assert.strictEqual(doc.querySelectorAll("#map path.map-path.selected")[0].dataset.id, "Dhaka");
    assert.strictEqual(doc.querySelectorAll("#locationList .location-item").length, 1);
    assert.strictEqual(doc.getElementById("resetView").hidden, false);
    doc.getElementById("resetView").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(doc.querySelectorAll("#map path.map-path.selected").length, 0);
  });

  check("district name toggle hides the labels", () => {
    const toggle = doc.getElementById("labelToggle");
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    const hidden = Array.from(doc.querySelectorAll(".district-label")).filter(el => el.style.display === "none");
    assert.ok(hidden.length > 50, "hidden labels: " + hidden.length);
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  });

  check("hovering a district shows a tooltip with its value", () => {
    const path = doc.querySelector('#map path.map-path[data-id="Dhaka"]');
    assert.ok(path, "Dhaka path exists");
    path.dispatchEvent(new window.MouseEvent("pointerenter", { bubbles: true, clientX: 100, clientY: 100 }));
    const tooltip = doc.querySelector(".map-tooltip");
    assert.strictEqual(tooltip.style.opacity, "1");
    assert.ok(tooltip.textContent.includes("ঢাকা"), "tooltip text: " + tooltip.textContent);
    assert.ok(/[\d.]+%/.test(tooltip.textContent), "tooltip value: " + tooltip.textContent);
    assert.ok(tooltip.querySelectorAll(".tt-col").length === 2, "raw report columns in tooltip");
    assert.ok(tooltip.textContent.includes("Collected"), "column labels: " + tooltip.textContent);
    path.dispatchEvent(new window.MouseEvent("pointerleave", { bubbles: true }));
    assert.strictEqual(tooltip.style.opacity, "0");
  });

  check("map panel layout keeps the legend and the empty state in place", () => {
    assert.ok(doc.querySelector(".map-container .map-legend #legend"), "legend inside the map panel");
    assert.ok(doc.querySelector(".sidebar #locationList"), "list inside the sidebar");
    assert.ok(doc.querySelector("#map .map-svg svg"), "svg mounted in its own layer");
    const title = doc.getElementById("legendMetric");
    assert.ok(/Collected Acc Qty|Collectable/.test(title.textContent), "legend names its metric: " + title.textContent);
    const svg = doc.querySelector("#map .map-svg svg");
    assert.ok(Number(svg.getAttribute("width")) > 100 && Number(svg.getAttribute("height")) > 100,
      "svg has an intrinsic size for aspect-based layout");
  });

  check("zoom controls sit inside the map panel", () => {
    const controls = doc.querySelector(".map-container .map-zoom");
    assert.ok(controls, "zoom controls in the map panel");
    ["zoomIn", "zoomOut", "zoomReset"].forEach(id => assert.ok(controls.querySelector("#" + id), id));
    assert.strictEqual(controls.querySelectorAll(".zoom-btn").length, 3);
  });

  check("exports stay neutral while a district is selected on screen", () => {
    const target = doc.querySelector('#locationList .location-item[data-shape="Dhaka"]');
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(doc.querySelectorAll("#map path.map-path.dimmed").length > 50, "screen is dimmed");
    const exported = window.eval(`SVGMap.buildExportSVG({ title: "t", legend: [], background: "#131c2e" })`);
    const opacities = (exported.markup.match(/fill-opacity="([\d.]+)"/g) || [])
      .map(value => parseFloat(value.split('"')[1]))
      .filter(value => value > 0 && value !== 1);
    assert.ok(opacities.length > 50, "regions exported: " + opacities.length);
    assert.ok(Math.min.apply(null, opacities) >= 0.4, "no dimmed region in the export: " + Math.min.apply(null, opacities));
    assert.ok(!/stroke="#38bdf8"/.test(exported.markup), "no selection outline in the export");
    doc.getElementById("drawerClose").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(doc.querySelectorAll("#map path.map-path.dimmed").length, 0, "screen restored");
  });

  check("export SVG is self-contained and carries legend + labels", () => {
    const exported = window.eval(`SVGMap.buildExportSVG({
      title: "test", subtitle: "sub",
      legend: [{ color: "#dc2626", label: "0 – 69.99%" }, { color: "#64748b", label: "ডেটা নেই" }],
      background: "#131c2e", text: "#eef2f8", muted: "#9aa8bd", note: "src.xlsx"
    })`);
    assert.strictEqual((exported.markup.match(/<path/g) || []).length, 64, "district paths");
    assert.ok(exported.markup.includes("0 – 69.99%") && exported.markup.includes("ডেটা নেই"));
    assert.ok(exported.markup.includes("test") && exported.markup.includes("src.xlsx"));
    assert.ok(exported.markup.includes('font-size'), "inline label typography");
    assert.ok(exported.markup.includes('fill="#'), "explicit fills");
    assert.ok(exported.height > 900 && exported.width === 800, exported.width + "x" + exported.height);
  });

  /* ---- layout: the map must always fit the panel ---------------------------- */
  const mapHost = doc.getElementById("mapSvg");
  const svgEl = doc.querySelector("#mapSvg svg");
  const viewBox = (svgEl.getAttribute("viewBox") || "0 0 800 1000").split(/\s+/).map(Number);
  const vbW = viewBox[2];
  const vbH = viewBox[3];
  let panelBox = { width: 470, height: 530 };
  const stubRects = () => {
    mapHost.getBoundingClientRect = () => ({
      width: panelBox.width, height: panelBox.height, left: 0, top: 0,
      right: panelBox.width, bottom: panelBox.height, x: 0, y: 0
    });
    svgEl.getBoundingClientRect = () => {
      const w = parseFloat(svgEl.style.width) || 0;
      const h = parseFloat(svgEl.style.height) || 0;
      return { width: w, height: h, left: 0, top: 0, right: w, bottom: h, x: 0, y: 0 };
    };
  };
  stubRects();

  check("the map is fitted to the panel and can never overflow it", () => {
    panelBox = { width: 470, height: 530 };
    stubRects();
    App.internals.refreshSize();
    const expected = Math.min(panelBox.width / vbW, panelBox.height / vbH) * vbW;
    const actual = parseFloat(svgEl.style.width);
    assert.ok(Math.abs(actual - expected) < 1, `fitted width ${actual} should be ~${expected}`);
    assert.ok(actual <= panelBox.width + 0.5, "fitted width fits the panel");
    const height = parseFloat(svgEl.style.height);
    assert.ok(height <= panelBox.height + 0.5, "fitted height fits the panel: " + height);
    assert.ok(Math.abs(height / actual - vbH / vbW) < 0.01, "aspect ratio preserved");
  });

  check("re-fitting keeps the map inside the panel at other sizes", () => {
    [{ width: 320, height: 700 }, { width: 1200, height: 300 }, { width: 640, height: 640 }].forEach(box => {
      panelBox = box;
      stubRects();
      App.internals.refreshSize();
      const w = parseFloat(svgEl.style.width);
      const h = parseFloat(svgEl.style.height);
      assert.ok(w <= box.width + 0.5 && h <= box.height + 0.5, `${w}x${h} overflows ${box.width}x${box.height}`);
      assert.ok(Math.abs(h / w - vbH / vbW) < 0.01, "aspect ratio preserved at " + box.width + "x" + box.height);
    });
    panelBox = { width: 470, height: 530 };
    stubRects();
    App.internals.refreshSize();
  });

  check("zoom out works below 100% and clamps at the minimum", () => {
    const out = doc.getElementById("zoomOut");
    assert.strictEqual(App.internals.getZoom(), 1);
    out.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(App.internals.getZoom() < 0.7, "first zoom out: " + App.internals.getZoom());
    for (let i = 0; i < 6; i++) out.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const clamped = App.internals.getZoom();
    assert.ok(clamped >= 0.39 && clamped <= 0.41, "clamped at the minimum: " + clamped);
    assert.strictEqual(doc.getElementById("zoomLevel").textContent, Math.round(clamped * 100) + "%");
    // the shrunken map is centred rather than pinned to a corner
    const transform = doc.querySelector("#map .map-paths").getAttribute("transform");
    const tx = Number(transform.match(/translate\((-?[\d.]+)/)[1]);
    assert.ok(tx > 0, "centred horizontally when smaller than the frame: " + transform);
    doc.getElementById("zoomReset").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(App.internals.getZoom(), 1);
    assert.match(doc.querySelector("#map .map-paths").getAttribute("transform"), /translate\(0\.00 0\.00\).*scale\(1/, "reset transform");
  });

  check("window resize re-fits the map automatically", () => {
    panelBox = { width: 900, height: 380 };
    stubRects();
    window.dispatchEvent(new window.Event("resize"));
    const height = parseFloat(svgEl.style.height);
    assert.ok(height <= 380.5, "re-fitted after resize: " + height);
    panelBox = { width: 470, height: 530 };
    stubRects();
    window.dispatchEvent(new window.Event("resize"));
  });

  check("expand mode fills the viewport and Esc leaves it", () => {
    const panel = doc.querySelector(".map-container");
    doc.getElementById("mapExpand").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(panel.classList.contains("map-expanded"), "panel expanded");
    assert.ok(doc.body.classList.contains("map-expanded-open"));
    assert.strictEqual(doc.getElementById("mapExpand").getAttribute("aria-pressed"), "true");
    assert.strictEqual(doc.querySelector("#mapExpand .map-expand-label").textContent, "ছোট করুন");
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.strictEqual(panel.classList.contains("map-expanded"), false, "Esc collapses");
    assert.strictEqual(doc.getElementById("mapExpand").getAttribute("aria-pressed"), "false");
    // keyboard shortcut toggles it back on
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", bubbles: true }));
    assert.ok(panel.classList.contains("map-expanded"), "F expands");
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", bubbles: true }));
    assert.strictEqual(panel.classList.contains("map-expanded"), false, "F collapses again");
  });

  check("zoom buttons, keyboard and readout drive the map transform", () => {
    const level = doc.getElementById("zoomLevel");
    const reset = doc.getElementById("zoomReset");
    const group = doc.querySelector("#map .map-paths");
    assert.strictEqual(level.textContent, "100%");
    assert.strictEqual(reset.disabled, true, "reset disabled at 1x");

    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(App.internals.getZoom() > 1.4, "zoom in: " + App.internals.getZoom());
    assert.match(group.getAttribute("transform"), /scale\(1\.[45]/, "paths are scaled");
    assert.strictEqual(level.textContent, "150%");
    assert.strictEqual(reset.disabled, false);

    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    doc.getElementById("zoomOut").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.ok(Math.abs(App.internals.getZoom() - 1.5) < 0.01, "zoom out returns to 1.5x: " + App.internals.getZoom());

    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "+", bubbles: true }));
    assert.ok(App.internals.getZoom() > 1.5, "keyboard + zooms in");
    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "0", bubbles: true }));
    assert.strictEqual(App.internals.getZoom(), 1, "keyboard 0 resets");
    assert.strictEqual(level.textContent, "100%");
    assert.strictEqual(reset.disabled, true);
  });

  check("district labels counter-scale so they stay readable when zoomed", () => {
    const label = doc.querySelector('.district-label[data-id="Dhaka"]');
    assert.strictEqual(label.getAttribute("transform"), "translate(0 0) scale(1.0000)".replace("0 0", label.getAttribute("transform").match(/translate\(([^)]+)\)/)[1]));
    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const scale = Number(label.getAttribute("transform").match(/scale\(([\d.]+)\)/)[1]);
    assert.ok(scale < 0.8 && scale > 0.5, "label counter-scaled: " + scale);
    doc.getElementById("zoomReset").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(Number(label.getAttribute("transform").match(/scale\(([\d.]+)\)/)[1]), 1);
  });

  check("zoom-to-district frames that district", () => {
    App.internals.zoomToShape("Rangamati");
    const transform = doc.querySelector("#map .map-paths").getAttribute("transform");
    assert.ok(App.internals.getZoom() > 2, "framed zoom: " + App.internals.getZoom());
    assert.ok(/translate\(-\d/.test(transform), "panned to the district: " + transform);
    App.internals.zoomToShape(null);
    assert.strictEqual(App.internals.getZoom(), 1);
  });

  check("at 100% the map cannot be dragged out of frame", () => {
    const paths = doc.querySelector("#map .map-paths");
    const fire = (type, x, y) => paths.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    fire("pointerdown", 200, 200);
    fire("pointermove", 100, 120);
    fire("pointerup", 100, 120);
    assert.match(paths.getAttribute("transform"), /translate\(0\.00 0\.00\) scale\(1/, "stay centred at 100%");
  });

  check("dragging a zoomed map pans it and never selects a district", () => {
    const paths = doc.querySelector("#map .map-paths");
    const before = { selected: App.internals.state.selected };
    const fire = (type, x, y) => paths.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));

    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const zoomed = App.internals.getZoom();
    assert.ok(zoomed > 2, "zoomed in first: " + zoomed);

    fire("pointerdown", 200, 200);
    fire("pointermove", 260, 240);
    fire("pointerup", 260, 240);
    const transform = paths.getAttribute("transform");
    const tx = Number(transform.match(/translate\((-?[\d.]+)/)[1]);
    assert.ok(tx < -20, "panned while zoomed: " + transform);
    assert.strictEqual(App.internals.state.selected, before.selected, "pan did not select a district");
    assert.strictEqual(doc.querySelectorAll("#map path.map-path.selected").length, 0, "nothing selected by dragging");
    doc.getElementById("zoomReset").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });

  check("wheel zooms at the pointer", () => {
    const svg = doc.querySelector("#map svg");
    const event = new window.MouseEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 });
    Object.defineProperty(event, "deltaY", { value: -240 });
    svg.dispatchEvent(event);
    assert.ok(App.internals.getZoom() > 1.2, "wheel zoom: " + App.internals.getZoom());
    doc.getElementById("zoomReset").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(App.internals.getZoom(), 1);
  });

  check("exports are un-zoomed and labels drop their counter-scale", () => {
    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    doc.getElementById("zoomIn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const label = doc.querySelector('.district-label[data-id="Dhaka"]');
    assert.ok(Number(label.getAttribute("transform").match(/scale\(([\d.]+)\)/)[1]) < 0.6, "zoomed screen state");
    const exported = window.eval(`SVGMap.buildExportSVG({ title: "t", legend: [], background: "#131c2e" })`);
    const scales = (exported.markup.match(/scale\(([\d.]+)\)/g) || []).map(value => Number(value.match(/[\d.]+/)[0]));
    assert.ok(scales.every(value => value >= 0.999), "no counter-scale in export: " + scales.slice(0, 4).join(","));
    assert.ok(!/data-bx/.test(exported.markup), "internal attributes stripped");
    assert.strictEqual(App.internals.getZoom() > 1, true, "screen keeps its zoom");
    doc.getElementById("zoomReset").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });

  check("exported SVG embeds the Bengali fonts as data URIs", async () => {
    const fontCss = await App.internals.embeddableFontCss();
    assert.ok(fontCss.includes("data:font/woff2;base64,"), "inlined fonts");
    assert.ok(/unicode-range/.test(fontCss), "subsets keep their ranges");
    assert.ok(fontCss.includes("font-family: 'Hind Siliguri'"));
    const exported = window.eval(`SVGMap.buildExportSVG({ title: "t", legend: [], background: "#131c2e", fontCss: ${JSON.stringify(fontCss)} })`);
    assert.ok(exported.markup.includes("data:font/woff2;base64,"), "fonts travel inside the export");
    assert.ok(exported.markup.indexOf("<style>") < exported.markup.indexOf("<path"), "style comes first");
    return null;
  });

  check("theme toggle flips the colour scheme", () => {
    const before = doc.documentElement.dataset.theme;
    doc.getElementById("themeToggle").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.notStrictEqual(doc.documentElement.dataset.theme, before);
  });

  {
    const before = window.__blobs.length;
    App.internals.exportCsv();
    const csv = await blobText(window.__blobs.length - 1);
    check("CSV export writes a header plus one row per district", () => {
      assert.strictEqual(window.__blobs.length, before + 1);
      assert.ok(/^\uFEFF?District,District \(BN\)/.test(csv), "header: " + JSON.stringify(csv.slice(0, 30)));
      assert.ok(csv.includes("Collectable Vs. Collected Amt. (%)") || csv.includes("Collectable Vs. Collected Amt. (%)"));
      assert.ok(csv.includes("Previous Month Overdue"));
      assert.strictEqual(csv.trim().split(/\r?\n/).length, 65);
      assert.ok(csv.includes("ঢাকা"));
    });

    const beforeJson = window.__blobs.length;
    App.internals.exportJson();
    const json = JSON.parse(await blobText(beforeJson));
    check("JSON export contains districts and plaza level data", () => {
      assert.strictEqual(json.districts.length, 64);
      assert.strictEqual(json.plazas.length, parsed.entries.length);
      assert.ok(json.plazas[0].qtyPct !== undefined);
    });
  }

  check("dataset is persisted for the next visit", () => {
    const raw = window.localStorage.getItem("plaza-map-dataset-v2");
    assert.ok(raw && raw.length > 1000, "localStorage payload");
    assert.strictEqual(JSON.parse(raw).entries.length, parsed.entries.length);
  });

  check("clear + demo data work without a report file", () => {
    doc.getElementById("clearBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(App.internals.state.entries.length, 0);
    assert.strictEqual(doc.getElementById("mapEmpty").hidden, false);
    doc.getElementById("demoBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const state = App.internals.state;
    assert.ok(state.entries.length > 600, "demo plazas: " + state.entries.length);
    assert.ok(Object.keys(state.stats).length > 50, "demo districts: " + Object.keys(state.stats).length);
  });

  await Promise.all(pending);
  report();
  dom.window.close();
  server.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
