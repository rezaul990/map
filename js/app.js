const App = (() => {
  let currentMap = "bd";
  let visited = { bd: new Set(), world: new Set() };
  let bdData = null, worldData = null;
  let customName = "", customImage = null;
  const STORAGE_KEY = "travel-map-state";

  async function init() {
    await Promise.all([loadBDData(), loadWorldData()]);
    loadData();
    initThemePicker();
    initMap("bd");
    initEventListeners();
    updateSidebar();
    updateProgress();
  }

  async function loadBDData() {
    const res = await fetch("data/bangladesh.geojson");
    bdData = await res.json();
  }

  async function loadWorldData() {
    const res = await fetch("data/world.geojson");
    const data = await res.json();
    worldData = {
      ...data,
      features: data.features.filter(f => {
        const name = (f.properties && f.properties.name) || "";
        return name !== "Antarctica";
      })
    };
  }

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.bd) visited.bd = new Set(saved.bd);
      if (saved.world) visited.world = new Set(saved.world);
      if (saved.theme) setTheme(saved.theme);
      if (saved.name) {
        customName = saved.name;
        document.getElementById("customName").value = saved.name;
      }
      if (saved.image) {
        customImage = saved.image;
        showImagePreview(saved.image);
      }
    } catch (e) {
      console.warn("Failed to load saved data", e);
    }
  }

  function saveData() {
    const data = {
      bd: Array.from(visited.bd),
      world: Array.from(visited.world),
      theme: document.documentElement.getAttribute("data-theme") || "default",
      name: customName,
      image: customImage
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function initThemePicker() {
    const themes = ["default","emerald","sunset","violet","rose","gold","mint","coral","aurora"];
    const container = document.getElementById("themePicker");
    themes.forEach(theme => {
      const swatch = document.createElement("div");
      swatch.className = "theme-swatch" + (theme === "default" ? " active" : "");
      swatch.dataset.theme = theme;
      swatch.title = theme.charAt(0).toUpperCase() + theme.slice(1);
      swatch.addEventListener("click", () => setTheme(theme));
      container.appendChild(swatch);
    });
  }

  function setTheme(theme) {
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    document.querySelectorAll(".theme-swatch").forEach(s => {
      s.classList.toggle("active", s.dataset.theme === (theme || "default"));
    });
    if (SVGMap.paths.length) SVGMap.updateStyles(getPathStyle);
  }

  function initMap(type) {
    const data = type === "bd" ? bdData : worldData;
    SVGMap.render(data, type, toggleLocation, getPathStyle);
    currentMap = type;
    updateSidebar();
    updateProgress();
    document.getElementById("sidebarTitle").textContent =
      type === "bd" ? "যেসব জেলায় গিয়েছি" : "যেসব দেশে গিয়েছি";
  }

  function getLocationName(feature) {
    if (currentMap === "bd") {
      const name = feature.properties.shapeName;
      return BD_DISTRICTS[name] ? BD_DISTRICTS[name].en : name;
    }
    return feature.properties.name;
  }

  function getLocationBNName(feature) {
    if (currentMap === "bd") {
      const name = feature.properties.shapeName;
      return BD_DISTRICTS[name] ? BD_DISTRICTS[name].bn : "";
    }
    return "";
  }

  function getLocationId(feature) {
    if (currentMap === "bd") return feature.properties.shapeName;
    return feature.id || feature.properties.name;
  }

  function getPathStyle(feature) {
    const id = getLocationId(feature);
    const isVisited = visited[currentMap].has(id);
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

  function toggleLocation(feature, mapType) {
    const id = getLocationId(feature);
    const name = getLocationName(feature);

    if (visited[mapType].has(id)) {
      visited[mapType].delete(id);
    } else {
      visited[mapType].add(id);
    }

    SVGMap.updateStyles(getPathStyle);
    updateSidebar();
    updateProgress();
    saveData();
    showToast(`"${name}" ${visited[mapType].has(id) ? "added" : "removed"}`);
  }

  function getVisitedList() {
    const data = currentMap === "bd" ? bdData : worldData;
    return data.features.map(f => {
      const id = getLocationId(f);
      const name = getLocationName(f);
      const bnName = getLocationBNName(f);
      const isVisited = visited[currentMap].has(id);
      return { id, name, bnName, isVisited, feature: f };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function updateSidebar(filter = "") {
    const list = getVisitedList();
    const filtered = filter
      ? list.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()) ||
                            (item.bnName && item.bnName.includes(filter)))
      : list;

    const container = document.getElementById("locationList");
    container.innerHTML = "";

    filtered.forEach(item => {
      container.appendChild(createListItem(item, currentMap));
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);">কিছু পাওয়া যায়নি</div>`;
    }
  }

  function createListItem(item, type) {
    const div = document.createElement("div");
    div.className = "location-item" + (item.isVisited ? " visited" : "");
    div.dataset.id = item.id;

    const flag = type === "world" && item.feature.id ? flagFromAlpha3(item.feature.id) : "";

    div.innerHTML = `
      <div class="location-checkbox">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <span class="location-name">${item.name}${item.bnName ? ' <span style="color:var(--text-dim);font-size:0.8em">' + item.bnName + '</span>' : ''}</span>
      ${flag ? `<span class="location-flag">${flag}</span>` : ''}
    `;

    div.addEventListener("click", () => {
      toggleLocation(item.feature, type);
    });

    return div;
  }

  function updateProgress() {
    const data = currentMap === "bd" ? bdData : worldData;
    const total = data ? data.features.length : (currentMap === "bd" ? 64 : 195);
    const count = visited[currentMap].size;
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
    const data = currentMap === "bd" ? bdData : worldData;
    data.features.forEach(f => {
      visited[currentMap].add(getLocationId(f));
    });
    SVGMap.updateStyles(getPathStyle);
    updateSidebar();
    updateProgress();
    saveData();
    showToast(`All ${visited[currentMap].size} selected`);
  }

  function clearAll() {
    visited[currentMap].clear();
    SVGMap.updateStyles(getPathStyle);
    updateSidebar();
    updateProgress();
    saveData();
    showToast("All cleared");
  }

  async function exportImage(format) {
    const overlay = createExportOverlay();
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add("show"), 10);

    try {
      await new Promise(r => setTimeout(r, 50));
      const svgEl = SVGMap.svg;
      const title = currentMap === "bd" ? "Bangladesh Travel Map" : "World Travel Map";
      const filename = `${title}_${customName || "MyMap"}`;

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
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        initMap(tab.dataset.map);
      });
    });

    document.getElementById("searchInput").addEventListener("input", (e) => {
      updateSidebar(e.target.value);
    });

    document.getElementById("selectAllBtn").addEventListener("click", selectAll);
    document.getElementById("clearAllBtn").addEventListener("click", clearAll);

    document.getElementById("exportPng").addEventListener("click", () => exportImage("png"));
    document.getElementById("exportJpg").addEventListener("click", () => exportImage("jpg"));
    document.getElementById("exportPdf").addEventListener("click", () => exportImage("pdf"));

    document.getElementById("copyData").addEventListener("click", copyData);

    document.getElementById("customName").addEventListener("input", (e) => {
      customName = e.target.value;
      saveData();
    });

    document.getElementById("customImage").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        showToast("Image too large (max 2MB)");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        customImage = ev.target.result;
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
      map: currentMap,
      visited: Array.from(visited[currentMap]),
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