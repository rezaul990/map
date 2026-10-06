const App = (() => {
  let bdData = null;
  let currentMetric = "collectedQty";
  let districtFilter = "all";
  let plazaData = null;
  let districtStats = {};
  const STORAGE_KEY = "plaza-map-state";

  const METRIC_COLUMNS = {
    collectedQty: "Collectable Vs. Collected Acc Qty (%)",
    collectableAmt: "Collectable Vs. Collected Amt (%)",
    overdueChange: "Overdue Increase/(Decrease)"
  };

  async function init() {
    await loadBDData();
    populateDistrictFilter();
    initMetricTabs();
    initEventListeners();
    updateLegend();
  }

  async function loadBDData() {
    const res = await fetch("data/bangladesh.geojson");
    bdData = await res.json();
  }

  function populateDistrictFilter() {
    const select = document.getElementById("districtFilter");
    const names = new Set();
    bdData.features.forEach(f => {
      const shape = f.properties.shapeName;
      const name = BD_DISTRICTS[shape] ? BD_DISTRICTS[shape].en : shape;
      names.add({ shape, name });
    });
    [...names].sort((a, b) => a.name.localeCompare(b.name)).forEach(({ shape, name }) => {
      const opt = document.createElement("option");
      opt.value = shape;
      opt.textContent = name;
      select.appendChild(opt);
    });
  }

  function initMetricTabs() {
    document.querySelectorAll(".metric-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".metric-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentMetric = tab.dataset.metric;
        updateLegend();
        renderMap();
        updateSidebar();
      });
    });
  }

  function initEventListeners() {
    document.getElementById("dataFile").addEventListener("change", handleFileUpload);
    document.getElementById("districtFilter").addEventListener("change", (e) => {
      districtFilter = e.target.value;
      renderMap();
      updateSidebar();
    });
    document.getElementById("searchInput").addEventListener("input", (e) => {
      updateSidebar(e.target.value);
    });
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById("uploadStatus");
    status.textContent = "ফাইল পড়া হচ্ছে...";
    status.classList.add("loading");

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      plazaData = parsePlazaRows(rows);
      districtStats = computeDistrictStats();
      status.textContent = `${Object.keys(plazaData).length} প্লাজা লোড হয়েছে`;
      status.classList.remove("loading");
      status.classList.add("success");

      document.getElementById("mapEmpty").style.display = "none";
      renderMap();
      updateSidebar();
      showToast("ডেটা লোড হয়েছে!");
    } catch (err) {
      console.error(err);
      status.textContent = "ফাইল পড়তে সমস্যা হয়েছে";
      status.classList.remove("loading");
      status.classList.add("error");
      showToast("ফাইল পড়তে ব্যর্থ হয়েছে");
    }
  }

  function parsePlazaRows(rows) {
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r];
      if (row && String(row[7] || "").trim() === "Plaza") {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx === -1) {
      throw new Error("Header row not found");
    }

    const out = {};
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const plaza = String(row[7] || "").trim();
      if (!plaza || plaza === "Plaza") continue;

      out[plaza] = {
        collectableQty: toNum(row[9]),
        collectedQty: toNum(row[10]),
        qtyPct: toNum(row[11]),
        collectableAmt: toNum(row[13]),
        collectedAmt: toNum(row[16]),
        advance: toNum(row[18]),
        totalCollection: toNum(row[19]),
        amtPct: toNum(row[20]),
        prevOverdue: toNum(row[21]),
        runningOverdue: toNum(row[23]),
        overdueChange: toNum(row[25])
      };
    }
    return out;
  }

  function toNum(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = parseFloat(String(v).replace(/,/g, ""));
    return isNaN(n) ? null : n;
  }

  function getDistrictForPlaza(plaza) {
    const found = PLAZA_DISTRICT.find(m => m.plaza === plaza);
    if (!found) return null;
    return normalizeDistrict(found.district);
  }

  function normalizeDistrict(name) {
    const map = {
      "Barishal": "Barisal",
      "Chapainawabganj": "Nawabganj",
      "Chattogram": "Chittagong",
      "Moulvibazar": "Maulvibazar",
      "Netrokona": "Netrakona",
      "Cumilla": "Comilla",
      "Jashore": "Jessore",
      "Khagrachhari": "Khagrachhari",
      "Bogura": "Bogra",
      "Brahmanbaria": "Brahamanbaria"
    };
    return map[name] || name;
  }

  function computeDistrictStats() {
    const stats = {};
    if (!plazaData) return stats;

    Object.keys(plazaData).forEach(plaza => {
      const district = getDistrictForPlaza(plaza);
      if (!district) return;
      if (!stats[district]) {
        stats[district] = { pcts: [], amounts: [], overdues: [], plazas: 0 };
      }
      const d = plazaData[plaza];
      if (d.qtyPct !== null) stats[district].pcts.push(d.qtyPct);
      if (d.amtPct !== null) stats[district].amounts.push(d.amtPct);
      if (d.overdueChange !== null) stats[district].overdues.push(d.overdueChange);
      stats[district].plazas++;
    });

    Object.keys(stats).forEach(d => {
      stats[d].avgQtyPct = avg(stats[d].pcts);
      stats[d].avgAmtPct = avg(stats[d].amounts);
      stats[d].sumOverdueChange = sum(stats[d].overdues);
    });
    return stats;
  }

  function avg(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function sum(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0);
  }

  function getMetricValue(district) {
    const s = districtStats[district];
    if (!s) return null;
    if (currentMetric === "collectedQty") return s.avgQtyPct;
    if (currentMetric === "collectableAmt") return s.avgAmtPct;
    if (currentMetric === "overdueChange") return s.sumOverdueChange;
    return null;
  }

  function getColorForValue(value, metric) {
    if (value === null || value === undefined) return "#64748b";

    // Overdue Increase/(Decrease): 0 or negative = Dark Green, >0 = Dark Red
    if (metric === "overdueChange") {
      if (value <= 0) return "#166534";
      return "#7f1d1d";
    }

    // Collected Acc Qty & Collectable Amt. (%): percentage bands
    if (value < 70) return "#dc2626";
    if (value < 80) return "#facc15";
    if (value < 90) return "#86efac";
    return "#16a34a";
  }

  function updateLegend() {
    const legend = document.getElementById("legend");
    let items;
    if (currentMetric === "overdueChange") {
      items = [
        { color: "#166534", label: "0 এবং নেতিবাচক (কমানো)" },
        { color: "#7f1d1d", label: "> 0 (বৃদ্ধি)" },
        { color: "#64748b", label: "কোনো ডেটা নেই" }
      ];
    } else {
      items = [
        { color: "#dc2626", label: "0 – 69.99%" },
        { color: "#facc15", label: "70 – 79.99%" },
        { color: "#86efac", label: "80 – 89.99%" },
        { color: "#16a34a", label: "90 – 100%" },
        { color: "#64748b", label: "কোনো ডেটা নেই" }
      ];
    }
    legend.innerHTML = items.map(it =>
      `<div class="legend-item"><span class="legend-swatch" style="background:${it.color}"></span> ${it.label}</div>`
    ).join("");
  }

  function getPathStyle(feature) {
    const shape = feature.properties.shapeName;
    const value = getMetricValue(shape);
    const color = getColorForValue(value, currentMetric);
    return {
      fill: color,
      stroke: "rgba(255,255,255,0.6)",
      strokeWidth: 1,
      fillOpacity: 0.85,
      className: value === null ? "no-data-region" : "data-region"
    };
  }

  function isFiltered(shape) {
    return districtFilter !== "all" && districtFilter !== shape;
  }

  function renderMap() {
    const data = {
      ...bdData,
      features: bdData.features.filter(f => {
        return !isFiltered(f.properties.shapeName);
      })
    };
    SVGMap.render(data, "bd", () => {}, getPathStyle, getLabel, getTooltip);
    document.getElementById("mapEmpty").style.display = "none";
  }

  function getLabel(feature) {
    const shape = feature.properties.shapeName;
    return BD_DISTRICTS[shape] ? BD_DISTRICTS[shape].bn : shape;
  }

  function getTooltip(feature) {
    const shape = feature.properties.shapeName;
    const name = BD_DISTRICTS[shape] ? BD_DISTRICTS[shape].en : shape;
    const bn = BD_DISTRICTS[shape] ? BD_DISTRICTS[shape].bn : "";
    const value = getMetricValue(shape);
    let display = "—";
    if (value !== null) {
      display = currentMetric === "overdueChange"
        ? (value > 0 ? "+" : "") + value.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : value.toFixed(1) + "%";
    }
    return `<strong>${name} ${bn}</strong><br><span class="tt-value">${display}</span>`;
  }

  function updateSidebar(filter = "") {
    const list = [];
    bdData.features.forEach(f => {
      const shape = f.properties.shapeName;
      const name = BD_DISTRICTS[shape] ? BD_DISTRICTS[shape].en : shape;
      const value = getMetricValue(shape);
      list.push({ shape, name, value, isFiltered: isFiltered(shape) });
    });

    const filtered = list.filter(item => {
      if (districtFilter !== "all" && item.shape !== districtFilter) return false;
      if (filter) {
        return item.name.toLowerCase().includes(filter.toLowerCase());
      }
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));

    const container = document.getElementById("locationList");
    container.innerHTML = "";

    filtered.forEach(item => {
      const div = document.createElement("div");
      div.className = "location-item";
      const color = getColorForValue(item.value, currentMetric);
      const display = item.value !== null
        ? (currentMetric === "overdueChange"
            ? (item.value > 0 ? "+" : "") + item.value.toLocaleString(undefined, { maximumFractionDigits: 0 })
            : item.value.toFixed(1) + "%")
        : "—";
      div.innerHTML = `
        <span class="district-dot" style="background:${color}"></span>
        <span class="location-name">${item.name}</span>
        <span class="location-value">${display}</span>
      `;
      container.appendChild(div);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);">কিছু পাওয়া যায়নি</div>`;
    }
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 2500);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);