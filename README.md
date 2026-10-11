# ওয়ালটন প্লাজা কালেকশন ম্যাপ (Walton Plaza Collection Map)

A framework-free web app that turns the plaza-wise collection report (Excel) into an
interactive district map of Bangladesh: colour-coded collection performance, per-district
drill-down, and downloadable summaries.

## Features

**Data**

- Upload the `.xls` / `.xlsx` export directly — no server, no upload to any backend
  (all parsing happens in the browser).
- Column detection from the header row, so inserted/renamed/reordered columns keep working;
  the old fixed 26-column layout stays supported as a fallback.
- Picks the first sheet that contains usable data, skips cover pages and total rows, and
  normalises `1,23,456.78`, `(1,500)`, `87.5%` style cells.
- Percent columns stored as fractions (`0.87`) are detected and scaled to `%` automatically.
- Plaza → district mapping (`data/plaza-district.json`, 700+ plazas) with alias handling for
  spelling variants (Bogura/Bogra, Chattogram/Chittagong, Chapainawabganj, …). Districts
  present in the report itself win over the mapping.
- Plazas that cannot be matched are reported instead of being silently dropped.
- The last dataset is kept in `localStorage`, so a reload keeps your data (and there is a
  **ডেমো ডেটা** button to explore the app without a report file).

**Visualisation**

- Three metrics: `Collected Acc Qty (%)`, `Collectable Vs. Collected Amt (%)`,
  `Overdue Increase/(Decrease)`.
- Per-district aggregation: average % for the two percentage metrics, net change for overdue.
- Aspect-correct projection (longitude × cos(latitude)), so Bangladesh is not stretched.
- Hover tooltips with value, plaza count and the other metrics; district labels that
  auto-hide when a district is too small to fit text.
- KPI cards (plazas, district coverage, national average, best/worst district) and a
  legend showing how many districts fall in each band.

**Interaction**

- Click a district (on the map or in the list) to open a detail drawer: metric values,
  amount/quantity totals, and every plaza in that district sorted by performance.
- Search by English name, Bengali name or plaza name (`/` focuses the search box).
- Sort by name, best/worst value, or plaza count; filter to a single district; reset view.
- Keyboard accessible districts (tab + Enter/Space), `Esc` clears the selection.
- Dark and light themes, responsive down to mobile (drawer becomes a bottom sheet).

**Export**

- PNG snapshot of the map with title, legend and source file name (self-contained SVG
  rendered through canvas).
- CSV of the district summary (UTF-8 with BOM, opens correctly in Excel).
- JSON with the district summary plus every plaza row — handy for other tools.

## Tech

- Vanilla HTML, CSS and JavaScript — no framework, no build step.
- Pure SVG map rendered from a local GeoJSON (64 districts), no map service or API key.
- SheetJS is vendored in `vendor/` (works offline) with a CDN fallback in `index.html`.

## Run

```sh
python -m http.server 8080
# or: npm start
```

Then open <http://localhost:8080>.

> Opening `index.html` directly via `file://` will not work: the browser blocks the
> `fetch()` of the local GeoJSON. Serve the folder over HTTP.

## Tests

```sh
npm install     # jsdom (dev only)
npm test        # parser unit tests + jsdom end-to-end UI test
```

- `tests/parser.test.js` — column detection, number coercion, percent scaling,
  district aliases and aggregation.
- `tests/e2e.test.js` — serves the app, loads it in jsdom, pushes a generated `.xlsx`
  through the real upload pipeline and asserts the UI (map, KPIs, legend, list, drawer,
  tooltips, filters, exports, persistence).

## Customise the district data

- `data/bangladesh.geojson` — district boundaries. Each feature needs a stable
  `properties.shapeName`, which the app uses as the district id.
- `js/data.js` — English/Bengali display names (`BD_DISTRICTS`) and the spelling aliases
  used when a report uses a different name (`BD_DISTRICT_ALIASES`).
- `data/plaza-district.json` — plaza → district/area/division master list.
- `css/style.css` — theme tokens live in `:root` and `[data-theme="light"]`.

## Project layout

```
index.html            markup: toolbar, KPIs, sidebar, map panel, detail drawer
css/style.css         design tokens, dark/light themes, responsive layout
js/data.js            district names + alias resolution (pure, unit tested)
js/parse.js           spreadsheet parsing + district aggregation (pure, unit tested)
js/map.js             SVG map: projection, labels, tooltip, hover/selection, export SVG
js/app.js             UI state, rendering, interactions, exports, persistence
js/plaza.js           plaza → district master data (generated)
vendor/xlsx.full.min.js  SheetJS build
tests/                node-based unit + e2e tests
```
