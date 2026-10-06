const SVGMap = {
  svg: null,
  paths: [],
  hoverId: null,
  tooltip: null,
  labels: [],

  render(data, type, onPathClick, getPathStyle, getLabel, getTooltip) {
    const container = document.getElementById("map");
    const bounds = this.getBounds(data);
    const width = 800;
    const height = 750;

    const svgNS = "http://www.w3.org/2000/svg";
    container.innerHTML = "";
    container.style.position = "relative";
    this.labels = [];

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
        onPathClick(feature, type);
      });
      path.addEventListener("mouseenter", event => {
        this.hoverId = id;
        this.updateStyles(getPathStyle);
        this.highlightLabel(id, true);
        if (getTooltip) this.showTooltip(event, getTooltip(feature));
      });
      path.addEventListener("mousemove", event => {
        if (this.tooltip) this.moveTooltip(event);
      });
      path.addEventListener("mouseleave", () => {
        this.hoverId = null;
        this.updateStyles(getPathStyle);
        this.highlightLabel(id, false);
        if (this.tooltip) this.tooltip.style.opacity = "0";
      });

      this.svg.appendChild(path);
      this.paths.push({ id, path, feature });

      if (getLabel) {
        const labelText = getLabel(feature);
        if (labelText) this.addLabel(feature, labelText, bounds, width, height);
      }
    });

    container.appendChild(this.svg);

    if (getTooltip) {
      this.tooltip = document.createElement("div");
      this.tooltip.className = "map-tooltip";
      this.tooltip.style.opacity = "0";
      container.appendChild(this.tooltip);
    }

    this.updateStyles(getPathStyle);
  },

  addLabel(feature, text, bounds, width, height) {
    const svgNS = "http://www.w3.org/2000/svg";
    const c = this.getCentroid(feature.geometry, bounds, width, height);
    if (!c) return;

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", c.x);
    label.setAttribute("y", c.y);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("class", "district-label");
    label.setAttribute("pointer-events", "none");
    label.textContent = text;
    this.svg.appendChild(label);
    this.labels.push({ id: feature.properties.shapeName, el: label });
  },

  highlightLabel(id, on) {
    this.labels.forEach(l => {
      if (l.id === id) {
        l.el.classList.toggle("hover", on);
      }
    });
  },

  getCentroid(geometry, bounds, width, height) {
    let lon = 0, lat = 0, count = 0;
    const each = ring => {
      ring.forEach(point => { lon += point[0]; lat += point[1]; count++; });
    };
    if (geometry.type === "Polygon") each(geometry.coordinates[0]);
    else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach(p => each(p[0]));
    if (!count) return null;
    lon /= count; lat /= count;
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
    const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * height;
    return { x, y };
  },

  showTooltip(event, html) {
    if (!this.tooltip) return;
    this.tooltip.innerHTML = html;
    this.tooltip.style.opacity = "1";
    this.moveTooltip(event);
  },

  moveTooltip(event) {
    if (!this.tooltip) return;
    const container = document.getElementById("map");
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left + 14;
    const y = event.clientY - rect.top - 10;
    this.tooltip.style.left = x + "px";
    this.tooltip.style.top = y + "px";
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