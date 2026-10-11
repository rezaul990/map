/**
 * Application shell: UI state, rendering and user interactions.
 */
const App = (() => {
  const GEO_URL = "data/bangladesh.geojson";
  const STORAGE_KEY = "plaza-map-dataset-v2";
  const PREF_KEY = "plaza-map-prefs-v2";
  const MAX_FILE_MB = 25;

  /**
   * Report metrics. `columns` are the raw report columns behind each metric,
   * exactly as they appear in the summary report:
   *
   *   Collected Acc Qty  -> Collectable Acc. Qty. | Collected Acc. Qty. | Collectable Vs. Collected Acc Qty (%)
   *   Collectable Amt.   -> Collectable Amt.      | Collected Amt.      | Collectable Vs. Collected Amt. (%)
   *   Overdue            -> Previous Month Overdue| Running Month Overdue | Overdue Increase/(Decrease)
   */
  const METRICS = {
    collectedQty: {
      label: "Collectable Vs. Collected Acc Qty (%)",
      short: "Collected Acc Qty",
      kind: "percent",
      columns: ["collectableQty", "collectedQty", "qtyPct"],
      hint: "জেলার মোট Collected Acc. Qty. ÷ মোট Collectable Acc. Qty. (নিচের কলাম থেকে জেলা-ভিত্তিক মান)"
    },
    collectableAmt: {
      label: "Collectable Vs. Collected Amt. (%)",
      short: "Collectable Amt.",
      kind: "percent",
      columns: ["collectableAmt", "collectedAmt", "amtPct"],
      hint: "জেলার মোট Collected Amt. ÷ মোট Collectable Amt. (নিচের কলাম থেকে জেলা-ভিত্তিক মান)"
    },
    overdueChange: {
      label: "Overdue Increase/(Decrease)",
      short: "Overdue",
      kind: "amount",
      columns: ["prevOverdue", "runningOverdue", "overdueChange"],
      hint: "Running Month Overdue − Previous Month Overdue (জেলার সব প্লাজার যোগফল) — ঋণাত্মক মান মানে ওভারডিউ কমেছে"
    }
  };

  /** Column labels as printed in the report. */
  const COLUMN_LABELS = {
    collectableQty: "Collectable Acc. Qty.",
    collectedQty: "Collected Acc. Qty.",
    qtyPct: "Collectable Vs. Collected Acc Qty (%)",
    collectableAmt: "Collectable Amt.",
    collectedAmt: "Collected Amt.",
    amtPct: "Collectable Vs. Collected Amt. (%)",
    prevOverdue: "Previous Month Overdue",
    runningOverdue: "Running Month Overdue",
    overdueChange: "Overdue Increase/(Decrease)",
    totalCollection: "Total Collection (Collected + Advance)",
    advance: "Collection Advance"
  };

  /** Absolute bands, matching the report's own 70/80/90 thresholds. */
  const FIXED_PERCENT_BANDS = [
    { color: "#dc2626", label: "0 – 69.99%", min: -Infinity, max: 70, tone: "bad" },
    { color: "#facc15", label: "70 – 79.99%", min: 70, max: 80, tone: "warn" },
    { color: "#86efac", label: "80 – 89.99%", min: 80, max: 90, tone: "ok" },
    { color: "#16a34a", label: "90 – 100%", min: 90, max: Infinity, tone: "good" }
  ];
  const FIXED_OVERDUE_BANDS = [
    { color: "#16a34a", label: "0 বা তার কম (ওভারডিউ কমেছে)", min: -Infinity, max: 0.0000001, tone: "good" },
    { color: "#dc2626", label: "0 এর বেশি (ওভারডিউ বেড়েছে)", min: 0.0000001, max: Infinity, tone: "bad" }
  ];

  const NO_DATA_COLOR = "#64748b";

  /** Colours used by the adaptive (quartile) scale, best -> worst. */
  const RANK_COLORS = { best: "#16a34a", good: "#86efac", warn: "#facc15", bad: "#dc2626" };
  const OVERDUE_RANK_COLORS = { best: "#16a34a", warn: "#facc15", bad: "#dc2626" };

  const nf = new Intl.NumberFormat("en-IN");

  const state = {
    geo: null,
    entries: [],
    stats: {},
    plazaIndex: new Map(),
    metric: "collectedQty",
    scale: "relative",
    districtFilter: "all",
    search: "",
    sort: "name-asc",
    selected: null,
    showLabels: true,
    fileName: "",
    savedAt: null,
    percentScale: 1,
    unmatched: [],
    skipped: 0,
    columns: null,
    ready: false,
    geoError: null
  };

  /* ------------------------------------------------------------------ init */

  async function init() {
    const prefs = loadPrefs();
    applyTheme(prefs.theme || "dark");
    state.scale = prefs.scale === "fixed" ? "fixed" : "relative";
    bindStaticEvents();
    initMap();

    try {
      const res = await fetch(GEO_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.geo = await res.json();
      if (!state.geo || !Array.isArray(state.geo.features) || !state.geo.features.length) {
        throw new Error("জিওডেটা খালি");
      }
    } catch (err) {
      state.geoError = err;
      showMapNotice(
        "ম্যাপ ডেটা লোড করা যায়নি",
        "ফাইলটি সরাসরি খোলা হলে (file://) ব্রাউজার ডেটা পড়তে দেয় না। ফোল্ডারটি একটি লোকাল সার্ভারে চালান — " +
        "<code>python -m http.server 8080</code> — তারপর <code>http://localhost:8080</code> খুলুন।"
      );
      renderKpis();
      renderLegend();
      renderList();
      return;
    }

    SVGMap.setData(state.geo.features);
    document.getElementById("mapEmpty").hidden = false;
    populateDistrictFilter();
    renderKpis();
    renderLegend();

    const restored = loadDataset();
    if (restored) {
      loadEntries(restored.entries, {
        fileName: restored.fileName,
        savedAt: restored.savedAt,
        percentScale: restored.percentScale,
        skipped: restored.skipped,
        columns: restored.columns,
        restored: true
      });
    } else {
      renderList();
    }
  }

  function initMap() {
    SVGMap.init({
      container: document.getElementById("mapSvg"),
      accent: themeColors().accent,
      getStyle: styleForFeature,
      getLabel: featureLabel,
      getTooltip: featureTooltip,
      onSelect: selectDistrict
    });
  }

  function bindStaticEvents() {
    document.getElementById("dataFile").addEventListener("change", handleFileUpload);
    document.getElementById("districtFilter").addEventListener("change", event => {
      state.districtFilter = event.target.value;
      renderMapSelection();
      renderList();
    });

    const search = document.getElementById("searchInput");
    search.addEventListener("input", event => {
      state.search = event.target.value.trim();
      renderList();
    });

    document.getElementById("sortSelect").addEventListener("change", event => {
      state.sort = event.target.value;
      renderList();
    });

    document.getElementById("scaleSelect").addEventListener("change", event => {
      state.scale = event.target.value === "fixed" ? "fixed" : "relative";
      savePrefs({ scale: state.scale });
      renderAll();
      showToast(state.scale === "fixed" ? "নির্দিষ্ট থ্রেশহোল্ড (৭০/৮০/৯০%) দেখানো হচ্ছে" : "তুলনামূলক স্কেল দেখানো হচ্ছে");
    });

    document.querySelectorAll(".metric-tab").forEach(tab => {
      tab.addEventListener("click", () => setMetric(tab.dataset.metric));
    });

    document.getElementById("labelToggle").addEventListener("change", event => {
      state.showLabels = event.target.checked;
      SVGMap.setLabelsVisible(state.showLabels);
      savePrefs({ showLabels: state.showLabels });
    });

    document.getElementById("themeToggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      applyTheme(next);
      savePrefs({ theme: next });
    });

    document.getElementById("resetView").addEventListener("click", () => {
      state.districtFilter = "all";
      document.getElementById("districtFilter").value = "all";
      clearSelection();
      renderMapSelection();
      renderList();
    });

    document.getElementById("clearBtn").addEventListener("click", clearDataset);
    document.getElementById("demoBtn").addEventListener("click", loadDemoData);

    // export menu
    const exportBtn = document.getElementById("exportBtn");
    const exportMenu = document.getElementById("exportMenu");
    exportBtn.addEventListener("click", event => {
      event.stopPropagation();
      const open = exportMenu.hasAttribute("hidden");
      if (open) exportMenu.removeAttribute("hidden"); else exportMenu.setAttribute("hidden", "");
      exportBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", () => {
      exportMenu.setAttribute("hidden", "");
      exportBtn.setAttribute("aria-expanded", "false");
    });
    exportMenu.addEventListener("click", event => {
      const target = event.target.closest("[data-export]");
      if (!target) return;
      exportMenu.setAttribute("hidden", "");
      runExport(target.dataset.export);
    });

    // drawer
    document.getElementById("drawerClose").addEventListener("click", clearSelection);
    document.getElementById("drawerBackdrop").addEventListener("click", clearSelection);
    document.getElementById("drawerFilterBtn").addEventListener("click", () => {
      if (!state.selected) return;
      state.districtFilter = state.selected;
      document.getElementById("districtFilter").value = state.selected;
      renderMapSelection();
      renderList();
      closeDrawer();
      showToast(`${featureLabel({ properties: { shapeName: state.selected } })} জেলা ফিল্টার করা হয়েছে`);
    });

    document.addEventListener("keydown", event => {
      const tag = (event.target.tagName || "").toLowerCase();
      if (event.key === "Escape") {
        clearSelection();
        return;
      }
      if (event.key === "/" && tag !== "input" && tag !== "select" && tag !== "textarea") {
        event.preventDefault();
        search.focus();
      }
    });
  }

  /* --------------------------------------------------------------- theming */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    const toggle = document.getElementById("themeToggle");
    if (toggle) toggle.setAttribute("aria-label", theme === "light" ? "ডার্ক থিম" : "লাইট থিম");
  }

  function themeColors() {
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
    return {
      background: read("--bg-elevated", "#1e293b"),
      text: read("--text", "#f1f5f9"),
      muted: read("--text-muted", "#94a3b8"),
      accent: read("--accent", "#38bdf8")
    };
  }

  /* ----------------------------------------------------------- data loading */

  async function handleFileUpload(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setStatus(`ফাইলটি অনেক বড় (${(file.size / 1048576).toFixed(1)} MB) — সর্বোচ্চ ${MAX_FILE_MB} MB`, "error");
      showToast("ফাইল সাইজ বেশি", "error");
      return;
    }
    if (typeof XLSX === "undefined") {
      setStatus("Excel লাইব্রেরি লোড হয়নি — ইন্টারনেট সংযোগ দেখুন", "error");
      return;
    }

    setStatus(`“${file.name}” পড়া হচ্ছে...`, "loading");
    document.body.classList.add("busy");
    try {
      await ingestBuffer(await file.arrayBuffer(), file.name);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "ফাইল পড়তে সমস্যা হয়েছে", "error");
      showToast("ফাইল পড়া যায়নি — ফরম্যাট দেখুন", "error");
    } finally {
      document.body.classList.remove("busy");
    }
  }

  /** Workbook buffer -> parsed entries -> UI. Shared by uploads and tests. */
  async function ingestBuffer(buffer, fileName) {
    if (typeof XLSX === "undefined") throw new Error("Excel লাইব্রেরি লোড হয়নি — ইন্টারনেট সংযোগ দেখুন");
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const parsed = parseWorkbook(workbook);
    loadEntries(parsed.entries, {
      fileName: fileName || "",
      percentScale: parsed.percentScale,
      skipped: parsed.skipped,
      columns: parsed.columns,
      sheet: parsed.sheet
    });
    showToast(`${parsed.entries.length} প্লাজার ডেটা লোড হয়েছে`);
    return parsed;
  }

  /** Try every sheet until one yields usable rows. */
  function parseWorkbook(workbook) {
    const errors = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (!rows.length) continue;
      try {
        const parsed = PlazaParser.parseRows(rows, bdResolveDistrict);
        parsed.sheet = sheetName;
        return parsed;
      } catch (err) {
        errors.push(err.message);
      }
    }
    throw new Error(errors[0] || "কোনো শীটে ব্যবহারযোগ্য ডেটা পাওয়া যায়নি");
  }

  /** Compute stats, refresh the whole UI and persist. */
  function loadEntries(entries, meta) {
    state.entries = entries;
    state.fileName = meta.fileName || "";
    state.savedAt = meta.restored ? meta.savedAt : new Date().toISOString();
    state.percentScale = meta.percentScale || 1;
    state.skipped = meta.skipped || 0;
    state.columns = meta.columns || null;

    const plazaIndex = PlazaParser.buildPlazaIndex(mappingData(), bdResolveDistrict);
    state.plazaIndex = plazaIndex;
    const { stats, unmatched } = PlazaParser.buildStats(entries, plazaIndex);
    state.stats = stats;
    state.unmatched = unmatched;
    state.ready = entries.length > 0;

    if (!meta.restored) persistDataset();
    document.getElementById("mapEmpty").hidden = true;
    document.getElementById("resetView").hidden = true;
    document.getElementById("exportBtn").disabled = false;
    document.getElementById("clearBtn").disabled = false;

    if (state.selected && !state.stats[state.selected]) clearSelection();
    renderAll();
    updateStatusLine(meta);
  }

  function updateStatusLine(meta) {
    const covered = Object.keys(state.stats).length;
    const total = state.geo ? state.geo.features.length : 0;
    const parts = [
      `${nf.format(state.entries.length)} প্লাজা`,
      `${covered}/${total} জেলা`
    ];
    if (state.fileName) parts.push(state.fileName);
    if (meta && meta.restored) parts.push("সেভ করা ডেটা থেকে লোড হয়েছে");
    setStatus(parts.join(" • "), "success");

    const notes = [];
    if (state.percentScale === 100) notes.push("শতকরা মান ফ্র্যাকশন থেকে % এ রূপান্তর করা হয়েছে");
    if (state.unmatched.length) {
      notes.push(`${state.unmatched.length}টি প্লাজার জেলা শনাক্ত হয়নি (যেমন: ${state.unmatched.slice(0, 3).join(", ")})`);
    }
    const noteEl = document.getElementById("dataNotes");
    noteEl.innerHTML = notes.length
      ? notes.map(note => `<div class="note">⚠ ${escapeHtml(note)}</div>`).join("")
      : "";
  }

  function clearDataset() {
    if (state.ready && !window.confirm("আপলোড করা ডেটা মুছে ফেলা হবে — আপনি নিশ্চিত?")) return;
    state.entries = [];
    state.stats = {};
    state.unmatched = [];
    state.ready = false;
    state.fileName = "";
    state.savedAt = null;
    state.columns = null;
    localStorage.removeItem(STORAGE_KEY);
    clearSelection();
    document.getElementById("exportBtn").disabled = true;
    document.getElementById("clearBtn").disabled = true;
    document.getElementById("mapEmpty").hidden = false;
    document.getElementById("resetView").hidden = true;
    document.getElementById("dataNotes").innerHTML = "";
    setStatus("ডেটা মুছে ফেলা হয়েছে — নতুন Excel ফাইল আপলোড করুন", "");
    renderAll();
    showToast("ডেটা মুছে ফেলা হয়েছে");
  }

  /** Deterministic sample dataset so the app can be explored without a report file. */
  function loadDemoData() {
    const mapping = mappingData();
    if (!mapping.length) return;
    const entries = mapping.map((row, i) => {
      const seed = hashString(row.plaza + i);
      const qtyPct = round1(55 + (seed % 450) / 10);
      const amtPct = round1(Math.max(35, Math.min(100, qtyPct + ((seed >> 3) % 90) / 10 - 4.5)));
      const overdueChange = Math.round(((seed >> 5) % 4000) - 1800);
      const collectableAmt = 250000 + (seed % 900) * 1000;
      return {
        plaza: row.plaza,
        districtFromFile: null,
        area: row.area || "",
        division: row.division || "",
        data: {
          collectableQty: 500 + (seed % 900),
          collectedQty: Math.round((500 + (seed % 900)) * qtyPct / 100),
          qtyPct,
          collectableAmt,
          collectedAmt: Math.round(collectableAmt * amtPct / 100),
          advance: 0,
          totalCollection: Math.round(collectableAmt * amtPct / 100),
          prevOverdue: 10000 + (seed % 50000),
          runningOverdue: 10000 + (seed % 50000) + overdueChange,
          overdueChange
        }
      };
    });
    loadEntries(entries, { fileName: "ডেমো ডেটা (নমুনা)", percentScale: 1, skipped: 0, columns: null });
    showToast("ডেমো ডেটা দেখানো হচ্ছে — আসল রিপোর্ট আপলোড করলে এটি প্রতিস্থাপিত হবে");
  }

  function hashString(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }

  function mappingData() {
    return typeof PLAZA_DISTRICT !== "undefined" && Array.isArray(PLAZA_DISTRICT) ? PLAZA_DISTRICT : [];
  }

  /* ------------------------------------------------------------ persistence */

  function persistDataset() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        savedAt: state.savedAt,
        fileName: state.fileName,
        percentScale: state.percentScale,
        skipped: state.skipped,
        columns: state.columns,
        entries: state.entries.map(entry => ({
          plaza: entry.plaza,
          districtFromFile: entry.districtFromFile || null,
          area: entry.area || "",
          division: entry.division || "",
          data: entry.data
        }))
      }));
    } catch (err) {
      console.warn("ডেটা সেভ করা যায়নি", err);
    }
  }

  function loadDataset() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries) || !parsed.entries.length) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (err) { return {}; }
  }

  function savePrefs(patch) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign({}, loadPrefs(), patch)));
    } catch (err) { /* ignore */ }
  }

  /* --------------------------------------------------------------- metrics */

  function metricConfig() {
    return METRICS[state.metric] || METRICS.collectedQty;
  }

  function metricValue(shape) {
    return PlazaParser.metricValue(state.stats[shape], state.metric);
  }

  function metricAvailable() {
    if (!state.ready) return true;
    return state.entries.some(entry => {
      const key = state.metric === "overdueChange" ? "overdueChange"
        : state.metric === "collectableAmt" ? "amtPct" : "qtyPct";
      return entry.data[key] !== null && entry.data[key] !== undefined;
    });
  }

  let bandCache = { key: null, bands: [] };

  /**
   * Colour bands for the active metric.
   *
   * "fixed"    -> the report's own thresholds (70/80/90%).
   * "relative" -> quartiles of the districts present in the data, so reports whose
   *               collection rates sit far below 70% (e.g. 5–30%) still produce a
   *               readable map instead of a solid red country. Overdue is judged
   *               against each district's own overdue book.
   */
  function bands() {
    const key = [state.metric, state.scale, state.entries.length, Object.keys(state.stats).length].join("|");
    if (bandCache.key === key) return bandCache.bands;
    const computed = state.scale === "fixed" ? fixedBands() : relativeBands();
    bandCache = { key, bands: computed };
    return computed;
  }

  function fixedBands() {
    return (state.metric === "overdueChange" ? FIXED_OVERDUE_BANDS : FIXED_PERCENT_BANDS)
      .map(band => Object.assign({}, band));
  }

  function relativeBands() {
    const percent = metricConfig().kind === "percent";
    const values = [];
    Object.keys(state.stats).forEach(shape => {
      const value = metricValue(shape);
      if (value !== null && value !== undefined && isFinite(value)) values.push(value);
    });
    if (values.length < 4) return fixedBands();

    values.sort((a, b) => a - b);
    const q = p => quantile(values, p);
    const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
    const fmt = v => isFinite(v) ? (percent ? v.toFixed(2) + "%" : nf.format(Math.round(v))) : "—";

    if (!percent) {
      // overdue: relative growth compared with each district's own overdue book
      const [low, high] = [q(0.34), q(0.67)];
      return [
        { color: OVERDUE_RANK_COLORS.best, label: `কম বেড়েছে / কমেছে (নিচের ১/৩)`, min: -Infinity, max: low, tone: "good" },
        { color: OVERDUE_RANK_COLORS.warn, label: `মাঝারি বৃদ্ধি (${fmt(low)} – ${fmt(high)})`, min: low, max: high, tone: "warn" },
        { color: OVERDUE_RANK_COLORS.bad, label: `সবচেয়ে বেশি বৃদ্ধি (> ${fmt(high)})`, min: high, max: Infinity, tone: "bad" }
      ];
    }

    return [
      { color: RANK_COLORS.bad, label: `সবচেয়ে দুর্বল ২৫% (≤ ${fmt(q1)})`, min: -Infinity, max: q1, tone: "bad" },
      { color: RANK_COLORS.warn, label: `২৫–৫০% (${fmt(q1)} – ${fmt(q2)})`, min: q1, max: q2, tone: "warn" },
      { color: RANK_COLORS.good, label: `৫০–৭৫% (${fmt(q2)} – ${fmt(q3)})`, min: q2, max: q3, tone: "ok" },
      { color: RANK_COLORS.best, label: `সেরা ২৫% (> ${fmt(q3)})`, min: q3, max: Infinity, tone: "good" }
    ];
  }

  /** Linear-interpolated percentile of a sorted numeric array. */
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  function colorFor(value) {
    if (value === null || value === undefined || isNaN(value)) return NO_DATA_COLOR;
    const band = bands().find(b => value >= b.min && value < b.max);
    return band ? band.color : NO_DATA_COLOR;
  }

  function toneFor(value) {
    if (value === null || value === undefined || isNaN(value)) return "";
    const band = bands().find(b => value >= b.min && value < b.max);
    return band ? (band.tone || "") : "";
  }

  function setMetric(metric) {
    if (!METRICS[metric] || metric === state.metric) return;
    state.metric = metric;
    savePrefs({ metric });
    document.querySelectorAll(".metric-tab").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.metric === metric);
      tab.setAttribute("aria-selected", String(tab.dataset.metric === metric));
    });
    bandCache = { key: null, bands: [] };
    renderKpis();
    renderLegend();
    renderMapSelection();
    renderList();
    if (state.selected) renderDrawer();
  }

  /* ------------------------------------------------------------ formatting */

  function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) return "—";
    return value.toFixed(2) + "%";
  }

  function formatAmount(value, alwaysSign) {
    if (value === null || value === undefined || isNaN(value)) return "—";
    const rounded = Math.round(value);
    const sign = rounded > 0 && (alwaysSign || state.metric === "overdueChange");
    return (sign ? "+" : "") + nf.format(rounded);
  }

  function formatValue(value) {
    return metricConfig().kind === "percent" ? formatPercent(value) : formatAmount(value);
  }

  /** Format any raw report column value. */
  function columnValue(key, value) {
    if (value === null || value === undefined || isNaN(value)) return "—";
    if (/pct$/i.test(key) && key !== "totalCollection") return formatPercent(value);
    if (key === "overdueChange") return formatAmount(value, true);
    return nf.format(Math.round(value));
  }

  /** Short header for the plaza table columns. */
  function columnShortLabel(key) {
    return {
      collectableQty: "Collectable",
      collectedQty: "Collected",
      qtyPct: "%",
      collectableAmt: "Collectable",
      collectedAmt: "Collected",
      amtPct: "%",
      prevOverdue: "Prev. Overdue",
      runningOverdue: "Running",
      overdueChange: "Increase/(Decr.)"
    }[key] || key;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /** Compact value used inside the map/KPI cards. */
  function formatCompact(value) {
    if (value === null || value === undefined || isNaN(value)) return "—";
    const abs = Math.abs(value);
    if (metricConfig().kind === "amount" && abs >= 1e6) {
      const sign = value < 0 ? "-" : "";
      if (abs >= 1e7) return sign + (abs / 1e7).toFixed(2).replace(/\.00$/, "") + " Cr";
      return sign + (abs / 1e5).toFixed(1).replace(/\.0$/, "") + " L";
    }
    return formatValue(value);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  /* ------------------------------------------------------------ map hooks */

  function styleForFeature(feature) {
    const value = metricValue(feature.properties.shapeName);
    return {
      fill: colorFor(value),
      stroke: "#ffffff",
      strokeOpacity: 0.55,
      strokeWidth: 1,
      fillOpacity: value === null ? 0.45 : 0.92
    };
  }

  function featureLabel(feature) {
    const shape = feature.properties.shapeName;
    return bdDistrictInfo(shape).bn || shape;
  }

  function featureTooltip(feature) {
    const shape = feature.properties.shapeName;
    const stat = state.stats[shape];
    const info = bdDistrictInfo(shape);
    const value = metricValue(shape);
    const rows = [];

    if (value === null) {
      rows.push('<span class="tt-value dim">এই মেট্রিকে ডেটা নেই</span>');
      if (!state.ready) rows.push('<span class="tt-hint">ডেটা ফাইল আপলোড করুন</span>');
    } else {
      rows.push(`<span class="tt-value">${formatValue(value)}</span>`);
      rows.push(`<span class="tt-hint">${metricConfig().label}</span>`);
      // the raw report columns this value was built from
      rows.push(`<span class="tt-columns">${columnLines(stat).join("")}</span>`);
    }
    if (stat) {
      const others = [];
      if (state.metric !== "collectedQty") others.push(`Qty: ${formatPercent(metricValueFor(stat, "collectedQty"))}`);
      if (state.metric !== "collectableAmt") others.push(`Amt: ${formatPercent(metricValueFor(stat, "collectableAmt"))}`);
      if (state.metric !== "overdueChange" && stat.sumOverdueChange !== null) {
        others.push(`Overdue: ${nf.format(Math.round(stat.sumOverdueChange))}`);
      }
      rows.push(`<span class="tt-meta">${nf.format(stat.plazas)} প্লাজা${others.length ? " • " + others.join(" • ") : ""}</span>`);
    }
    return `<strong>${escapeHtml(info.bn)} <span class="tt-en">${escapeHtml(info.en)}</span></strong>${rows.join("")}`;
  }

  function metricValueFor(stat, metric) {
    return PlazaParser.metricValue(stat, metric);
  }

  /** Rows for the active metric's report columns, e.g. Collectable / Collected / %. */
  function columnLines(stat) {
    if (!stat) return [];
    const columns = PlazaParser.metricColumns(stat, state.metric);
    if (!columns) return [];
    const lines = [];
    const money = ["collectableAmt", "collectedAmt", "prevOverdue", "runningOverdue", "overdueChange"];
    const fmt = (key, value) => money.indexOf(key) === -1 ? nf.format(Math.round(value)) : nf.format(Math.round(value));
    lines.push(`<span class="tt-col"><em>${escapeHtml(COLUMN_LABELS[columns.base.key] || columns.base.key)}</em><b>${fmt(columns.base.key, columns.base.value)}</b></span>`);
    lines.push(`<span class="tt-col"><em>${escapeHtml(COLUMN_LABELS[columns.collected.key] || columns.collected.key)}</em><b>${fmt(columns.collected.key, columns.collected.value)}</b></span>`);
    return lines;
  }

  function selectDistrict(id) {
    if (state.selected === id) {
      clearSelection();
      return;
    }
    state.selected = id;
    renderMapSelection();
    renderList();
    renderDrawer();
    openDrawer();
  }

  function clearSelection() {
    if (!state.selected) { closeDrawer(); return; }
    state.selected = null;
    renderMapSelection();
    renderList();
    closeDrawer();
  }

  function openDrawer() {
    document.getElementById("drawer").classList.add("open");
    document.getElementById("drawer").setAttribute("aria-hidden", "false");
    document.getElementById("drawerBackdrop").hidden = false;
    document.body.classList.add("drawer-open");
  }

  function closeDrawer() {
    document.getElementById("drawer").classList.remove("open");
    document.getElementById("drawer").setAttribute("aria-hidden", "true");
    document.getElementById("drawerBackdrop").hidden = true;
    document.body.classList.remove("drawer-open");
  }

  /* ----------------------------------------------------------- rendering */

  function renderAll() {
    renderKpis();
    renderLegend();
    renderMapSelection();
    renderList();
    const hint = document.getElementById("metricHint");
    if (hint) {
      const scaleNote = state.scale === "fixed"
        ? " • রঙ: নির্দিষ্ট থ্রেশহোল্ড"
        : " • রঙ: তুলনামূলক (চারটি ভাগে ভাগ করা)";
      hint.textContent = metricConfig().hint + scaleNote;
    }
  }

  function renderMapSelection() {
    if (state.geoError) return;
    // a district filter focuses that district on the map (others dim, never disappear)
    const focus = state.selected || (state.districtFilter !== "all" ? state.districtFilter : null);
    SVGMap.setSelected(focus);
    const resetBtn = document.getElementById("resetView");
    if (resetBtn) resetBtn.hidden = state.districtFilter === "all" && !state.selected;
    renderMapNotice();
  }

  function renderMapNotice() {
    if (state.ready && !metricAvailable()) {
      const missing = state.metric === "overdueChange" ? "Overdue Increase/(Decrease)" : metricConfig().label;
      showMapNotice("এই মেট্রিকের ডেটা নেই", `আপলোড করা রিপোর্টে “${missing}” কলামটি পাওয়া যায়নি।`);
    } else if (state.ready) {
      hideMapNotice();
    }
  }

  function showMapNotice(title, text) {
    const notice = document.getElementById("mapNotice");
    notice.hidden = false;
    notice.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${text}</p>`;
  }

  function hideMapNotice() {
    document.getElementById("mapNotice").hidden = true;
  }

  function renderKpis() {
    const container = document.getElementById("kpis");
    const covered = Object.keys(state.stats).length;
    const totalDistricts = state.geo ? state.geo.features.length : 64;
    const cards = [];

    cards.push({
      label: "মোট প্লাজা",
      value: state.ready ? nf.format(state.entries.length) : "—",
      sub: state.unmatched.length ? `${state.unmatched.length}টি প্লাজার জেলা শনাক্ত হয়নি` : "সব প্লাজা জেলায় ম্যাপ হয়েছে",
      tone: state.unmatched.length ? "warn" : ""
    });

    cards.push({
      label: "জেলা কভারেজ",
      value: state.ready ? `${covered}/${totalDistricts}` : `0/${totalDistricts}`,
      sub: state.ready ? `${totalDistricts - covered}টি জেলায় প্লাজা ডেটা নেই` : "ডেটা আপলোড করুন",
      tone: state.ready && covered === totalDistricts ? "good" : ""
    });

    const national = state.ready ? PlazaParser.nationalMetric(state.entries, state.metric) : null;
    cards.push({
      label: state.metric === "overdueChange" ? "মোট Overdue পরিবর্তন" : "জাতীয় হার (সব প্লাজা)",
      value: national === null ? "—" : formatCompact(national),
      sub: metricConfig().label,
      tone: national === null ? "" : (state.metric === "overdueChange"
        ? (national <= 0 ? "good" : "bad")
        : (national >= 90 ? "good" : national < 80 ? "bad" : "warn"))
    });

    const ranked = rankedDistricts();
    cards.push({
      label: state.metric === "overdueChange" ? "সর্বোচ্চ হ্রাস" : "সেরা পারফরম্যান্স",
      value: ranked.length ? bdDistrictInfo(ranked[0].shape).bn : "—",
      sub: ranked.length ? formatCompact(ranked[0].value) : "ডেটা নেই",
      tone: "good"
    });
    cards.push({
      label: state.metric === "overdueChange" ? "সর্বোচ্চ বৃদ্ধি" : "দুর্বল পারফরম্যান্স",
      value: ranked.length ? bdDistrictInfo(ranked[ranked.length - 1].shape).bn : "—",
      sub: ranked.length ? formatCompact(ranked[ranked.length - 1].value) : "ডেটা নেই",
      tone: "bad"
    });

    container.innerHTML = cards.map(card => `
      <div class="kpi ${card.tone ? "kpi-" + card.tone : ""}">
        <span class="kpi-label">${escapeHtml(card.label)}</span>
        <span class="kpi-value">${escapeHtml(card.value)}</span>
        <span class="kpi-sub">${escapeHtml(card.sub)}</span>
      </div>
    `).join("");
  }

  /** Districts ordered best -> worst for the active metric. */
  function rankedDistricts() {
    const list = [];
    Object.keys(state.stats).forEach(shape => {
      const value = metricValue(shape);
      if (value === null || value === undefined) return;
      list.push({ shape, value });
    });
    list.sort((a, b) => state.metric === "overdueChange" ? a.value - b.value : b.value - a.value);
    return list;
  }

  function renderLegend() {
    const legendEl = document.getElementById("legend");
    const counts = new Map();
    let noData = 0;

    if (state.geo) {
      state.geo.features.forEach(feature => {
        const value = metricValue(feature.properties.shapeName);
        if (value === null || value === undefined) { noData++; return; }
        const color = colorFor(value);
        counts.set(color, (counts.get(color) || 0) + 1);
      });
    }

    const items = bands().map(band => ({
      color: band.color,
      label: band.label,
      count: counts.get(band.color) || 0
    }));
    items.push({ color: NO_DATA_COLOR, label: "ডেটা নেই", count: noData });

    legendEl.innerHTML = items.map(item => `
      <div class="legend-item${item.count === 0 ? " empty" : ""}">
        <span class="legend-swatch" style="background:${item.color}"></span>
        <span class="legend-label">${escapeHtml(item.label)}</span>
        <span class="legend-count">${item.count}</span>
      </div>
    `).join("");
  }

  function populateDistrictFilter() {
    const select = document.getElementById("districtFilter");
    select.innerHTML = '<option value="all">সব জেলা</option>';
    const options = state.geo.features
      .map(feature => ({
        shape: feature.properties.shapeName,
        info: bdDistrictInfo(feature.properties.shapeName)
      }))
      .sort((a, b) => a.info.en.localeCompare(b.info.en));

    options.forEach(({ shape, info }) => {
      const option = document.createElement("option");
      option.value = shape;
      option.textContent = `${info.bn} — ${info.en}`;
      select.appendChild(option);
    });
  }

  function renderList() {
    const container = document.getElementById("locationList");
    if (!state.geo) { container.innerHTML = ""; return; }

    const query = PlazaParser.normKey(state.search);
    let rows = state.geo.features.map(feature => {
      const shape = feature.properties.shapeName;
      const info = bdDistrictInfo(shape);
      const stat = state.stats[shape];
      return {
        shape,
        info,
        value: metricValue(shape),
        plazas: stat ? stat.plazas : 0
      };
    });

    if (state.districtFilter !== "all") {
      rows = rows.filter(row => row.shape === state.districtFilter);
    }
    if (query) {
      rows = rows.filter(row => {
        const stat = state.stats[row.shape];
        const plazaHit = stat && stat.list.some(entry => PlazaParser.normKey(entry.plaza).includes(query));
        return PlazaParser.normKey(row.info.en).includes(query) ||
          PlazaParser.normKey(row.info.bn).includes(query) ||
          PlazaParser.normKey(row.shape).includes(query) ||
          plazaHit;
      });
    }

    const byName = (a, b) => a.info.en.localeCompare(b.info.en);
    if (state.sort === "name-asc") rows.sort(byName);
    else if (state.sort === "name-desc") rows.sort((a, b) => byName(b, a));
    else if (state.sort === "value-desc" || state.sort === "value-asc") {
      const dir = state.sort === "value-desc" ? -1 : 1;
      rows.sort((a, b) => {
        if (a.value === null && b.value === null) return byName(a, b);
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return (a.value - b.value) * dir;
      });
    } else if (state.sort === "plazas") {
      rows.sort((a, b) => b.plazas - a.plazas || byName(a, b));
    }

    const isPercent = metricConfig().kind === "percent";
    container.innerHTML = rows.map(row => {
      const barWidth = isPercent && row.value !== null ? Math.max(0, Math.min(100, row.value)) : 0;
      return `
        <button class="location-item${row.shape === state.selected ? " active" : ""}" data-shape="${row.shape}">
          <span class="district-dot" style="background:${colorFor(row.value)}"></span>
          <span class="location-main">
            <span class="location-name">${escapeHtml(row.info.bn)}<em>${escapeHtml(row.info.en)}</em></span>
            ${isPercent ? `<span class="location-bar"><i style="width:${barWidth}%;background:${colorFor(row.value)}"></i></span>` : ""}
          </span>
          <span class="location-value${row.value === null ? " dim" : ""}">${formatValue(row.value)}</span>
          <span class="location-plazas">${row.plazas ? nf.format(row.plazas) + " প্লাজা" : "—"}</span>
        </button>`;
    }).join("");

    if (!rows.length) {
      container.innerHTML = '<div class="list-empty">কোনো জেলা পাওয়া যায়নি</div>';
    }

    container.querySelectorAll(".location-item").forEach(el => {
      const shape = el.dataset.shape;
      el.addEventListener("click", () => selectDistrict(shape));
      el.addEventListener("pointerenter", () => SVGMap.setHovered(shape));
      el.addEventListener("pointerleave", () => SVGMap.setHovered(null));
      el.addEventListener("focus", () => SVGMap.setHovered(shape));
      el.addEventListener("blur", () => SVGMap.setHovered(null));
    });

    const countEl = document.getElementById("listCount");
    if (countEl) {
      countEl.textContent = state.ready
        ? `${rows.length} জেলা দেখানো হচ্ছে`
        : "ডেটা আপলোড করলে ফলাফল দেখা যাবে";
    }
    renderDrawer();
  }

  function renderDrawer() {
    if (!state.selected) return;
    const shape = state.selected;
    const info = bdDistrictInfo(shape);
    const stat = state.stats[shape];

    document.getElementById("drawerTitle").textContent = info.bn || shape;
    document.getElementById("drawerSub").textContent = stat
      ? `${info.en} • ${nf.format(stat.plazas)} প্লাজা`
      : `${info.en} • কোনো প্লাজা ডেটা নেই`;

    const columns = stat ? PlazaParser.metricColumns(stat, state.metric) : null;
    const stats = [];
    stats.push({ label: metricConfig().label, value: formatValue(metricValue(shape)), primary: true });
    if (columns) {
      stats.push({ label: COLUMN_LABELS[columns.base.key] || columns.base.key, value: columnValue(columns.base.key, columns.base.value) });
      stats.push({ label: COLUMN_LABELS[columns.collected.key] || columns.collected.key, value: columnValue(columns.collected.key, columns.collected.value) });
    }
    if (columns && columns.pctAvg !== undefined && columns.pctAvg !== null) {
      stats.push({ label: "প্লাজা-ভিত্তিক গড় %", value: formatPercent(columns.pctAvg) });
    } else if (stat) {
      stats.push({ label: "প্লাজা", value: nf.format(stat.plazas) });
    }

    document.getElementById("drawerStats").innerHTML = stats.map(item => `
      <div class="drawer-stat${item.primary ? " primary" : ""}">
        <span class="drawer-stat-label">${escapeHtml(item.label)}</span>
        <span class="drawer-stat-value">${escapeHtml(item.value)}</span>
      </div>`).join("");

    // the other two metric groups, in full, so the drawer mirrors the report columns
    const groups = [
      { keys: ["collectableQty", "collectedQty", "qtyPct"], value: stat ? metricValueFor(stat, "collectedQty") : null },
      { keys: ["collectableAmt", "collectedAmt", "amtPct"], value: stat ? metricValueFor(stat, "collectableAmt") : null },
      {
        keys: ["prevOverdue", "runningOverdue", "overdueChange"],
        value: stat ? stat.sumOverdueChange : null,
        label: "Previous Month Overdue → Running Month Overdue"
      }
    ];
    const totals = stat && stat.sum ? `
      <div class="drawer-totals">
        ${groups.map(group => `
          <div class="drawer-total-row">
            <span class="drawer-total-value">${escapeHtml(columnValue(group.keys[2], group.value))}</span>
            <span class="drawer-total-keys">${escapeHtml(group.label || group.keys.map(key => COLUMN_LABELS[key]).join(" + "))}</span>
          </div>`).join("")}
        <div class="drawer-total-row">
          <span class="drawer-total-value">${nf.format(stat.plazas)}</span>
          <span class="drawer-total-keys">প্লাজা</span>
        </div>
        <div class="drawer-total-row">
          <span class="drawer-total-value">${columnValue("totalCollection", stat.sum.totalCollection)}</span>
          <span class="drawer-total-keys">${escapeHtml(COLUMN_LABELS.totalCollection || "Total Collection (Collected + Advance)")}</span>
        </div>
      </div>` : "";

    const listEl = document.getElementById("drawerList");
    const listTitle = document.getElementById("drawerListTitle");
    if (!stat || !stat.list.length) {
      listTitle.textContent = "প্লাজা তালিকা";
      listEl.innerHTML = '<div class="list-empty">এই জেলার জন্য কোনো প্লাজা ডেটা পাওয়া যায়নি</div>';
    } else {
      const metricColumns = METRICS[state.metric].columns;
      const sorted = stat.list.slice().sort((a, b) => {
        const av = a.data[metricColumns[2]];
        const bv = b.data[metricColumns[2]];
        if (av === null) return 1;
        if (bv === null) return -1;
        return state.metric === "overdueChange" ? av - bv : bv - av;
      });
      const isPercent = metricConfig().kind === "percent";
      listTitle.textContent = `প্লাজা তালিকা (${nf.format(sorted.length)})`;
      listEl.innerHTML = `
        <div class="drawer-table-head">
          <span>প্লাজা</span>
          ${metricColumns.map(key => `<span>${escapeHtml(columnShortLabel(key))}</span>`).join("")}
        </div>` + sorted.map(entry => `
        <div class="drawer-row">
          <span class="drawer-row-main">
            <span class="drawer-row-name">${escapeHtml(entry.plaza.replace(/^Walton Plaza-/, ""))}</span>
            <span class="drawer-row-meta">${escapeHtml(entry.area || entry.division || "")}</span>
          </span>
          ${metricColumns.map(key => `
            <span class="drawer-cell${entry.data[key] === null ? " dim" : ""}${key === metricColumns[2] ? " strong" : ""}">
              ${key === metricColumns[2] ? formatValue(entry.data[key]) : columnValue(key, entry.data[key])}
            </span>`).join("")}
        </div>`).join("");
    }
    const totalsHost = document.getElementById("drawerTotals");
    if (totalsHost) totalsHost.innerHTML = totals;
  }

  function setStatus(text, tone) {
    const el = document.getElementById("uploadStatus");
    el.textContent = text;
    el.className = "upload-status" + (tone ? " " + tone : "");
  }

  function showToast(message, tone) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast show" + (tone ? " " + tone : "");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = "toast"; }, 3200);
  }

  /* ---------------------------------------------------------------- export */

  async function runExport(kind) {
    if (!state.ready) return;
    try {
      if (kind === "csv") exportCsv();
      else if (kind === "json") exportJson();
      else await exportImage();
    } catch (err) {
      console.error(err);
      showToast("এক্সপোর্ট করা যায়নি", "error");
    }
  }

  function exportRows() {
    return state.geo.features
      .map(feature => {
        const shape = feature.properties.shapeName;
        const stat = state.stats[shape];
        const info = bdDistrictInfo(shape);
        const sum = stat ? stat.sum : null;
        return {
          district: info.en,
          districtBn: info.bn,
          plazas: stat ? stat.plazas : 0,
          collectableQty: sum ? sum.collectableQty : null,
          collectedQty: sum ? sum.collectedQty : null,
          qtyPct: stat ? metricValueFor(stat, "collectedQty") : null,
          collectableAmt: sum ? sum.collectableAmt : null,
          collectedAmt: sum ? sum.collectedAmt : null,
          amtPct: stat ? metricValueFor(stat, "collectableAmt") : null,
          prevOverdue: sum ? sum.prevOverdue : null,
          runningOverdue: sum ? sum.runningOverdue : null,
          overdueChange: stat ? stat.sumOverdueChange : null
        };
      })
      .sort((a, b) => a.district.localeCompare(b.district));
  }

  function exportCsv() {
    const header = ["District", "District (BN)", "Plazas",
      "Collectable Acc. Qty.", "Collected Acc. Qty.", "Collectable Vs. Collected Acc Qty (%)",
      "Collectable Amt.", "Collected Amt.", "Collectable Vs. Collected Amt. (%)",
      "Previous Month Overdue", "Running Month Overdue", "Overdue Increase/(Decrease)"];
    const numeric = ["plazas", "collectableQty", "collectedQty", "qtyPct", "collectableAmt", "collectedAmt",
      "amtPct", "prevOverdue", "runningOverdue", "overdueChange"];
    const lines = [header.join(",")];
    exportRows().forEach(row => {
      lines.push([
        quote(row.district),
        quote(row.districtBn)
      ].concat(numeric.map(key => {
        const value = row[key];
        if (value === null || value === undefined) return "";
        return /pct$/i.test(key) ? value.toFixed(2) : String(Math.round(value));
      })).join(","));
    });
    download(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
      `plaza-district-summary-${stamp()}.csv`);
    showToast("জেলা সারসংক্ষেপ CSV ডাউনলোড হয়েছে");
  }

  function exportJson() {
    const payload = {
      generatedAt: new Date().toISOString(),
      source: state.fileName || null,
      metric: state.metric,
      districts: exportRows(),
      plazas: state.entries.map(entry => Object.assign({
        plaza: entry.plaza,
        district: entry.district || null,
        area: entry.area || "",
        division: entry.division || ""
      }, entry.data))
    };
    download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `plaza-collection-data-${stamp()}.json`);
    showToast("প্লাজা ডেটা JSON ডাউনলোড হয়েছে");
  }

  async function exportImage() {
    const colors = themeColors();
    const legendItems = bands().map(band => ({ color: band.color, label: band.label }));
    legendItems.push({ color: NO_DATA_COLOR, label: "ডেটা নেই" });

    const { markup, width, height } = SVGMap.buildExportSVG({
      title: "ওয়ালটন প্লাজা কালেকশন ম্যাপ",
      subtitle: `${metricConfig().label} — জেলাভিত্তিক`,
      legend: legendItems,
      background: colors.background,
      text: colors.text,
      muted: colors.muted,
      note: state.fileName ? `সোর্স: ${state.fileName}` : ""
    });

    const scale = 2;
    const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      await new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error("PNG তৈরি করা যায়নি")); return; }
          download(blob, `plaza-collection-map-${stamp()}.png`);
          resolve();
        }, "image/png");
      });
      showToast("ম্যাপ PNG ডাউনলোড হয়েছে");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("ছবি তৈরি করা যায়নি"));
      image.src = src;
    });
  }

  function quote(value) {
    const str = String(value === null || value === undefined ? "" : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }

  function stamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    init,
    internals: {
      state,
      setMetric,
      ingestBuffer,
      loadEntries,
      renderAll,
      renderList,
      selectDistrict,
      loadDemoData,
      exportCsv,
      exportJson
    }
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
