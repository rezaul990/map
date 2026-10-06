const SVGMap = {
  svg: null,
  paths: [],
  hoverId: null,

  render(data, onPathClick, getPathStyle) {
    const container = document.getElementById("map");
    const bounds = this.getBounds(data);
    const width = 800;
    const height = 750;

    const svgNS = "http://www.w3.org/2000/svg";
    container.innerHTML = "";

    this.svg = document.createElementNS(svgNS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Interactive map of Bangladesh districts");
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.svg.style.display = "block";
    this.paths = [];
    this.hoverId = null;

    data.features.forEach(feature => {
      const d = this.geometryToPath(feature.geometry, bounds, width, height);
      if (!d) return;

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("vector-effect", "non-scaling-stroke");
      const id = feature.properties.shapeName;
      path.dataset.id = id;

      const style = getPathStyle(feature);
      this.applyStyle(path, style);

      path.style.cursor = "pointer";
      path.addEventListener("click", event => {
        event.stopPropagation();
        onPathClick(feature);
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
      this.paths.push({ id, path, feature });
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
    const each = ring => {
      ring.forEach(point => {
        if (point[0] < minLon) minLon = point[0];
        if (point[0] > maxLon) maxLon = point[0];
        if (point[1] < minLat) minLat = point[1];
        if (point[1] > maxLat) maxLat = point[1];
      });
    };
    data.features.forEach(feature => {
      const geometry = feature.geometry;
      if (!geometry) return;
      if (geometry.type === "Polygon") each(geometry.coordinates[0]);
      else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach(polygon => each(polygon[0]));
    });
    return { minLon, maxLon, minLat, maxLat };
  },

  ringToPath(ring, bounds, width, height) {
    if (!ring || ring.length < 3) return "";
    return ring.map((point, index) => {
      const x = ((point[0] - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
      const y = ((bounds.maxLat - point[1]) / (bounds.maxLat - bounds.minLat)) * height;
      return (index === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    }).join(" ") + " Z";
  },

  geometryToPath(geometry, bounds, width, height) {
    if (!geometry) return "";
    if (geometry.type === "Polygon") {
      return this.ringToPath(geometry.coordinates[0], bounds, width, height);
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.map(polygon => this.ringToPath(polygon[0], bounds, width, height)).join(" ");
    }
    return "";
  }
};
