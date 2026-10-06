const App = (() => {
  let visited = new Set();
  let bdData = null;
  let customName = "";
  let customImage = null;
  const STORAGE_KEY = "travel-map-state";

  async function init() {
    await loadBDData();
    loadData();
    initThemePicker();
    initMap();
    initEventListeners();
    updateSidebar();
    updateProgress();
  }

  async function loadBDData() {
    const res = await fetch("data/bangladesh.geojson");
    if (!res.ok) throw new Error("Failed to load Bangladesh map data");
    bdData = await res.json();
  }

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const knownIds = new Set(bdData.features.map(getLocationId));
      if (Array.isArray(saved.bd)) {
        visited = new Set(saved.bd.filter(id => knownIds.has(id)));
      }
      if (saved.theme) setTheme(saved.theme);
      if (typeof saved.name === "string") {
        customName = saved.name;
        document.getElementById("customName").value = saved.name;
      }
      if (typeof saved.image === "string" && saved.image) {
        customImage = saved.image;
        showImagePreview(saved.image);
      }
    } catch (e) {
      console.warn("Failed to load saved data", e);
    }
  }

  function saveData() {
    const data = {
      bd: Array.from(visited),
      theme: document.documentElement.getAttribute("data-theme") || "default",
      name: customName,
      image: customImage
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function initThemePicker() {
    const themes = ["default", "emerald", "sunset", "violet", "rose", "gold", "mint", "coral", "aurora"];
    const container = document.getElementById("themePicker");
    const activeTheme = document.documentElement.getAttribute("data-theme") || "default";

    themes.forEach(theme => {
      const swatch = document.createElement("div");
      swatch.className = "theme-swatch" + (theme === activeTheme ? " active" : "");
      swatch.dataset.theme = theme;
      swatch.title = theme.charAt(0).toUpperCase() + theme.slice(1);
      swatch.setAttribute("role", "button");
      swatch.setAttribute("aria-label", `${swatch.title} theme`);
      swatch.tabIndex = 0;

      const selectTheme = () => {
        setTheme(theme);
        saveData();
      };
      swatch.addEventListener("click", selectTheme);
      swatch.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectTheme();
        }
      });
      container.appendChild(swatch);
    });
  }

  function setTheme(theme) {
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    document.querySelectorAll(".theme-swatch").forEach(swatch => {
      swatch.classList.toggle("active", swatch.dataset.theme === (theme || "default"));
    });
    if (SVGMap.paths.length) SVGMap.updateStyles(getPathStyle);
  }

  function initMap() {
    SVGMap.render(bdData, toggleLocation, getPathStyle);
  }

  function getLocationName(feature) {
    const name = feature.properties.shapeName;
    return BD_DISTRICTS[name] ? BD_DISTRICTS[name].en : name;
  }

  function getLocationBNName(feature) {
    const name = feature.properties.shapeName;
    return BD_DISTRICTS[name] ? BD_DISTRICTS[name].bn : "";
  }

  function getLocationId(feature) {
    return feature.properties.shapeName;
  }

  function getPathStyle(feature) {
    const isVisited = visited.has(getLocationId(feature));
    const cs = getComputedStyle(document.documentElement);

    if (isVisited) {
      const fillRaw = cs.getPropertyValue("--theme-fill").trim() || "rgba(56,189,248,0.6)";
      const strokeRaw = cs.getPropertyValue("--theme-stroke").trim() || "#0ea5e9";
      return {
        fill: fillRaw,
        stroke: strokeRaw,
        strokeWidth: 1.5,
        fillOpacity: 0.65,
        className: "visited-region"
      };
    }
    return {
      fill: "#94a3b8",
      stroke: "rgba(255,255,255,0.6)",
      strokeWidth: 1,
      fillOpacity: 0.08,
      className: "unvisited-region"
    };
  }

  function toggleLocation(feature) {
    const id = getLocationId(feature);
    const name = getLocationName(feature);

    if (visited.has(id)) {
      visited.delete(id);
    } else {
      visited.add(id);
    }

    SVGMap.updateStyles(getPathStyle);
    updateSidebar();
    updateProgress();
    saveData();
    showToast(`"${name}" ${visited.has(id) ? "added" : "removed"}`);
  }

  function getVisitedList() {
    return bdData.features.map(feature => {
      const id = getLocationId(feature);
      return {
        id,
        name: getLocationName(feature),
        bnName: getLocationBNName(feature),
        isVisited: visited.has(id),
        feature
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function updateSidebar(filter = "") {
    const list = getVisitedList();
    const normalizedFilter = filter.trim().toLowerCase();
    const filtered = normalizedFilter
      ? list.filter(item => item.name.toLowerCase().includes(normalizedFilter) ||
                            (item.bnName && item.bnName.includes(filter.trim())))
      : list;

    const container = document.getElementById("locationList");
    container.innerHTML = "";

    filtered.forEach(item => {
      container.appendChild(createListItem(item));
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);">কিছু পাওয়া যায়নি</div>`;
    }
  }

  function createListItem(item) {
    const div = document.createElement("div");
    div.className = "location-item" + (item.isVisited ? " visited" : "");
    div.dataset.id = item.id;
    div.setAttribute("role", "button");
    div.setAttribute("tabindex", "0");
    div.setAttribute("aria-pressed", String(item.isVisited));

    div.innerHTML = `
      <div class="location-checkbox">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <span class="location-name">${item.name}${item.bnName ? ' <span style="color:var(--text-dim);font-size:0.8em">' + item.bnName + '</span>' : ''}</span>
    `;

    const toggle = () => toggleLocation(item.feature);
    div.addEventListener("click", toggle);
    div.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });

    return div;
  }

  function updateProgress() {
    const total = bdData ? bdData.features.length : 64;
    const count = visited.size;
    document.getElementById("progressCount").textContent = count;
    document.getElementById("totalCount").textContent = total;
    const percentage = total > 0 ? (count / total * 100) : 0;
    document.getElementById("progressBar").style.width = percentage + "%";
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 2000);
  }

  function showImagePreview(dataUrl) {
    const placeholder = document.getElementById("imagePlaceholder");
    placeholder.innerHTML = `<img src="${dataUrl}" alt="Profile">`;
  }

  function selectAll() {
    bdData.features.forEach(feature => visited.add(getLocationId(feature)));
    SVGMap.updateStyles(getPathStyle);
    updateSidebar();
    updateProgress();
    saveData();
    showToast(`All ${visited.size} districts selected`);
  }

  function clearAll() {
    visited.clear();
    SVGMap.updateStyles(getPathStyle);
    updateSidebar();
    updateProgress();
    saveData();
    showToast("All districts cleared");
  }

  async function exportImage(format) {
    const overlay = createExportOverlay();
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add("show"), 10);

    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      const svgEl = SVGMap.svg;
      const filename = `Bangladesh_Travel_Map_${customName || "MyMap"}`;
      const canvas = await svgToCanvas(svgEl, 2);
      if (format === "png") {
        downloadCanvas(canvas, `${filename}.png`);
      } else if (format === "jpg") {
        downloadCanvas(canvas, `${filename}.jpg`, "image/jpeg", 0.9);
      } else if (format === "pdf") {
        exportPdf(canvas, filename);
      }
      showToast(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      console.error("Export error:", err);
      showToast("Export failed. Please try again.");
    } finally {
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 300);
    }
  }

  async function svgToCanvas(svgEl, scale = 2) {
    const rect = svgEl.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 420;

    const cloned = svgEl.cloneNode(true);
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    cloned.setAttribute("width", width);
    cloned.setAttribute("height", height);

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(cloned);
    source = '<?xml version="1.0" encoding="UTF-8"?>' + source;

    const svg64 = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(source)));

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Failed to load SVG image"));
      img.src = svg64;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function createExportOverlay() {
    const div = document.createElement("div");
    div.className = "export-overlay";
    div.innerHTML = `
      <div class="export-content">
        <div class="export-spinner"></div>
        <div class="export-text">Generating your map...</div>
      </div>
    `;
    return div;
  }

  function downloadCanvas(canvas, filename, mimeType, quality) {
    const link = document.createElement("a");
    link.download = filename;
    link.href = mimeType
      ? canvas.toDataURL(mimeType, quality)
      : canvas.toDataURL("image/png");
    link.click();
  }

  function exportPdf(canvas, filename) {
    const { jsPDF } = window.jspdf;
    const imgData = canvas.toDataURL("image/png");
    const orientation = canvas.width > canvas.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save(`${filename}.pdf`);
  }

  function initEventListeners() {
    document.getElementById("searchInput").addEventListener("input", event => {
      updateSidebar(event.target.value);
    });

    document.getElementById("selectAllBtn").addEventListener("click", selectAll);
    document.getElementById("clearAllBtn").addEventListener("click", clearAll);

    document.getElementById("exportPng").addEventListener("click", () => exportImage("png"));
    document.getElementById("exportJpg").addEventListener("click", () => exportImage("jpg"));
    document.getElementById("exportPdf").addEventListener("click", () => exportImage("pdf"));
    document.getElementById("copyData").addEventListener("click", copyData);

    document.getElementById("customName").addEventListener("input", event => {
      customName = event.target.value;
      saveData();
    });

    document.getElementById("customImage").addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        showToast("Image too large (max 2MB)");
        return;
      }
      const reader = new FileReader();
      reader.onload = loadEvent => {
        customImage = loadEvent.target.result;
        showImagePreview(customImage);
        saveData();
        showToast("Image added");
      };
      reader.readAsDataURL(file);
    });
  }

  function copyData() {
    const data = {
      name: customName || "Traveler",
      map: "bd",
      visited: Array.from(visited),
      theme: document.documentElement.getAttribute("data-theme") || "default",
      date: new Date().toISOString().split("T")[0]
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .then(() => showToast("Data copied to clipboard!"))
      .catch(() => showToast("Failed to copy data"));
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
