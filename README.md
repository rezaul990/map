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

**Metrics and the report columns behind them**

| Metric | Columns used from the report |
| --- | --- |
| Collectable Vs. Collected Acc Qty (%) | `Collectable Acc. Qty.` · `Collected Acc. Qty.` · `Collectable Vs. Collected Acc Qty (%)` |
| Collectable Vs. Collected Amt. (%) | `Collectable Amt.` · `Collected Amt.` · `Collectable Vs. Collected Amt. (%)` |
| Overdue Increase/(Decrease) | `Previous Month Overdue` · `Running Month Overdue` · `Overdue Increase/(Decrease)` |

A district's percentage is `Σ collected ÷ Σ collectable` across its plazas (the same way the
report totals a region); the plain average of the plaza percentages is shown next to it.
Overdue is the sum of the change column, with the previous and running overdue totals shown
alongside so growth can be judged against the district's overdue book.

**Colour scale**

- **তুলনামূলক (default)** – quartiles of the districts present in the data, so reports whose
  collection rates sit far below 70% (e.g. 5–35%) still produce a readable map instead of a
  solid red country. Overdue is split into "least / medium / most growth" for the same reason.
- **নির্দিষ্ট** – fixed thresholds: 60 / 70 / 80% for the collection percentages
  (0–59.99% red `#dc2626`, 60–69.99% yellow `#facc15`, 70–79.99% light green `#86efac`,
  80–100% dark green `#16a34a`); overdue uses 1 / 15,00,000 / 40,00,000 Tk bands
  (<1 green `#16a34a`, 1–14,99,999 bright yellow `#FFFF00`, 15,00,000–39,99,999 yellow
  `#facc15`, 40,00,000+ red `#dc2626`).

**Navigation**

- The SVG fills its drawing area and letterboxes the map (`preserveAspectRatio="xMidYMid meet"`),
  so the browser always renders the country as large as the available space allows and it can
  neither overflow the panel nor collapse to a thumbnail.
- The map's size does not depend on the stylesheet being fresh: the svg carries percentage
  `width`/`height` attributes, and the drawing box's offsets are repeated in a small inline
  `<style>` in `index.html` (using longhands, never the `inset` shorthand) so an old cached
  `style.css` cannot collapse the box and drop the map to the default 300×150 svg size.
  `tests/css.test.js` keeps the inline copy and `css/style.css` in agreement.
- On short windows the chrome around the map is trimmed, the KPI cards become one compact
  scrolling strip and the map keeps the full panel height. Where the panel is also wide (1000px+)
  the colour key floats in the empty margin beside the centred country instead of costing map
  height; on narrower panels it stays in flow under the map, because a floating key would sit on
  top of the country. `/css` and `/js` assets carry a `?v=` query so a browser can never mix an old script with
  a new stylesheet after a deploy.
- Zoom: `Ctrl`/`⌘` + mouse wheel (zooms at the pointer), pinch on touch, `+` / `−` buttons,
  double-click, or the `+` / `−` / `0` keys. A plain wheel scrolls the page instead of zooming, so
  scrolling past the panel can never leave the map stranded at 40%. Range is 40%–1000%: below 100%
  the map shrinks and stays centred, above it it fills the frame with pan limits so there are never
  empty edges. The level is shown next to the buttons, the reset button lights up when the view is
  not at 100%, and a **জুম N% — পুরো ম্যাপ দেখুন** chip appears over the map: one click restores the
  fit-to-panel view.
- Pan: drag the map (touch or mouse) while zoomed in. At 100% there is nothing to pan — dragging
  does nothing instead of pushing the map out of frame. Panning never selects a district.
- **পুরো স্ক্রিন** button (or `F`) expands the map to the whole viewport; `Esc` leaves it.
- The drawer has **এই জেলায় জুম করুন** to frame the selected district (and the map auto-frames it when
  you open a district while already zoomed in).
- **Shapes and names share one transform**, so a district and its label can never drift apart
  (they used to be in separate layers, which desynced them at other zoom levels).
- Names scale with the map, and any name that would rasterise below ~6.5px is hidden instead of
  drawn as mush — zooming in, expanding to full screen or a larger window brings them back.
  When a panel is too small for any name, a hint suggests `F` (full screen).

**Visualisation**
- Aspect-correct projection (longitude × cos(latitude)), so Bangladesh is not stretched.
- Hover tooltips show the value plus the raw report columns it came from, the plaza count
  and the other metrics; district labels auto-hide when a district is too small for text.
- KPI cards (plazas, district coverage, national average, best/worst district) and a
  legend showing how many districts fall in each band.

**Interaction**

- Click a district (on the map or in the list) to open a detail drawer: the active metric's
  columns, a summary of all three column groups, and every plaza in that district laid out
  like the report (plaza + the three metric columns), sorted by performance.
- Search by English name, Bengali name or plaza name (`/` focuses the search box).
- Sort by name, best/worst value, or plaza count; filter to a single district; reset view.
- Keyboard accessible districts (tab + Enter/Space), `Esc` clears the selection.
- Dark and light themes, responsive down to mobile (drawer becomes a bottom sheet).

**Export**

- PNG snapshot of the map with title, legend and source file name (self-contained SVG
  rendered through canvas; exports ignore the on-screen selection so they are never dimmed).
- CSV of the district summary with every report column (UTF-8 with BOM, opens in Excel).
- JSON with the district summary plus every plaza row — handy for other tools.

## Tech

- Vanilla HTML, CSS and JavaScript — no framework, no build step.
- Pure SVG map rendered from a local GeoJSON (64 districts), no map service or API key.
- SheetJS is vendored in `vendor/` (works offline) with a CDN fallback in `index.html`.
- **Fonts are self-hosted** in `vendor/fonts/` (Hind Siliguri, Bengali + Latin subsets, OFL). No font
  CDN is requested, so Bengali text renders correctly on offline/kiosk machines, and the PNG export
  inlines the fonts as data URIs so rasterised maps keep their Bangla lettering.
  `tests/fonts.test.js` fails the build if a UI string ever uses a character which is not covered by
  those subsets — a single missing glyph (like `≤`) makes browsers fall back and mangle the whole line.

## Run

```sh
python3 serve.py 8080
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

- `tests/parser.test.js` — column detection, number coercion, percent scaling, district
  aliases, aggregation, and a set of assertions against `tests/fixtures/report-sample.js`,
  a copy of a real "Target Hire Accounts Summary Report" (spacer columns, padded headers,
  multi-line header cells and all).
- `tests/fonts.test.js` — self-hosted font wiring and Bengali glyph coverage of every UI string.
- `tests/e2e.test.js` — serves the app, loads it in jsdom, pushes a generated `.xlsx`
  through the real upload pipeline and asserts the UI (map, KPIs, legend, list, drawer,
  tooltips, filters, exports, persistence).

## Customise the district data

- `data/bangladesh.geojson` — district boundaries. Each feature needs a stable
  `properties.shapeName`, which the app uses as the district id.
- `js/data.js` — English/Bengali display names (`BD_DISTRICTS`) and the spelling aliases
  used when a report uses a different name (`BD_DISTRICT_ALIASES`).
- `data/plaza-district.json` — plaza → district/area/division master list.
- `css/style.css` — theme tokens live in `:root` and `[data-theme="light"]`; `@font-face` rules
  at the top of the file describe the vendored fonts.

## Project layout

```
index.html            markup: toolbar, KPIs, sidebar, map panel, detail drawer
css/style.css         design tokens, dark/light themes, responsive layout
js/data.js            district names + alias resolution (pure, unit tested)
js/parse.js           spreadsheet parsing, metric column groups + aggregation (unit tested)
js/map.js             SVG map: projection, labels, tooltip, hover/selection, export SVG
js/app.js             UI state, rendering, interactions, exports, persistence
js/plaza.js           plaza → district master data (generated)
vendor/xlsx.full.min.js  SheetJS build
vendor/fonts/         self-hosted Hind Siliguri subsets (Bengali + Latin)
tests/                node-based unit + e2e tests (plus a real report fixture)
```
