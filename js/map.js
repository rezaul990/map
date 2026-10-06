const SVGMap = {
  svg: null,
  paths: [],
  currentType: "bd",
  hoverId: null,

  render(data, type, onPathClick, getPathStyle) {
    const container = document.getElementById("map");
    const bounds = this.getBounds(data);
    const width = type === "bd" ? 800 : 800;
    const height = type === "bd" ? 750 : 420;

    const svgNS = "http://www.w3.org/2000/svg";
    container.innerHTML = "";

    this.svg = document.createElementNS(svgNS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.svg.setAttribute("role", "img");
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.svg.style.display = "block";
    this.currentType = type;
    this.paths = [];

    data.features.forEach(f => {
      const d = this.geometryToPath(f.geometry, bounds, width, height);
      if (!d) return;

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("vector-effect", "non-scaling-stroke");
      const id = type === "bd" ? f.properties.shapeName : (f.id || f.properties.name);
      path.dataset.id = id;

      const style = getPathStyle(f);
      this.applyStyle(path, style);

      path.style.cursor = "pointer";
      path.addEventListener("click", (e) => {
        e.stopPropagation();
        onPathClick(f, type);
      });
      path.addEventListener("mouseenter", () => {
        this.hoverId = id;
        this.updateStyles(getPathStyle);
      });
      path.addEventListener("mouseleave", () => {
        this.hoverId = null;
        this.updateStyles(getPathStyle);
      });

      this.svg.appendChild(path);
      this.paths.push({ id, path, feature: f });
    });

    container.appendChild(this.svg);
    this.updateStyles(getPathStyle);
  },

  applyStyle(path, style) {
    path.setAttribute("fill", style.fill);
    path.setAttribute("stroke", style.stroke);
    path.setAttribute("stroke-width", style.strokeWidth);
    path.setAttribute("fill-opacity", style.fillOpacity);
    path.setAttribute("class", style.className || "");
  },

  updateStyles(getPathStyle) {
    this.paths.forEach(({ path, feature }) => {
      const style = getPathStyle(feature);
      if (this.hoverId && path.dataset.id === this.hoverId) {
        style.stroke = "#ffffff";
        style.strokeWidth = 2;
        style.fillOpacity = Math.min((parseFloat(style.fillOpacity) || 0) + 0.25, 1);
      }
      this.applyStyle(path, style);
    });
  },

  getBounds(data) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const each = (ring) => {
      ring.forEach(pt => {
        if (pt[0] < minLon) minLon = pt[0];
        if (pt[0] > maxLon) maxLon = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      });
    };
    data.features.forEach(f => {
      const g = f.geometry;
      if (!g) return;
      if (g.type === "Polygon") each(g.coordinates[0]);
      else if (g.type === "MultiPolygon") g.coordinates.forEach(p => each(p[0]));
    });
    return { minLon, maxLon, minLat, maxLat };
  },

  ringToPath(ring, bounds, width, height) {
    if (!ring || ring.length < 3) return "";
    return ring.map((pt, i) => {
      const x = ((pt[0] - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
      const y = ((bounds.maxLat - pt[1]) / (bounds.maxLat - bounds.minLat)) * height;
      return (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    }).join(" ") + " Z";
  },

  geometryToPath(geom, bounds, width, height) {
    if (!geom) return "";
    if (geom.type === "Polygon") {
      return this.ringToPath(geom.coordinates[0], bounds, width, height);
    }
    if (geom.type === "MultiPolygon") {
      return geom.coordinates.map(p => this.ringToPath(p[0], bounds, width, height)).join(" ");
    }
    return "";
  }
};