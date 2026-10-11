/**
 * Pure-SVG choropleth map of Bangladesh.
 *
 * The module owns the SVG: projection, paths, labels, tooltip, hover/selection state
 * and PNG/vector export. Data + colour decisions stay in app.js and are supplied
 * through the callbacks passed to init().
 */
const SVGMap = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const FONT = "'Hind Siliguri', 'Noto Sans Bengali', 'Inter', system-ui, sans-serif";
  const BASE_WIDTH = 800;
  const HEADER_H = 150;
  const LEGEND_ROW = 28;

  let container = null;
  let svg = null;
  let mapGroup = null;
  let labelGroup = null;
  let tooltip = null;
  let hooks = {};
  let items = [];
  let bounds = null;
  let width = BASE_WIDTH;
  let height = 1000;
  let selectedId = null;
  let hoverId = null;
  let labelsVisible = true;
  let accent = "#38bdf8";
  let plainRender = false;

  /* ------------------------------------------------------------------ setup */

  function init(options) {
    container = options.container;
    accent = options.accent || accent;
    hooks = {
      getStyle: options.getStyle || (() => ({})),
      getLabel: options.getLabel || (() => ""),
      getTooltip: options.getTooltip || (() => ""),
      onSelect: options.onSelect || (() => {})
    };
    container.innerHTML = "";
    container.style.position = "relative";
    container.classList.add("has-svg");

    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "বাংলাদেশের জেলাভিত্তিক কালেকশন ম্যাপ");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.classList.add("bd-map");
    mapGroup = document.createElementNS(NS, "g");
    mapGroup.setAttribute("class", "map-paths");
    labelGroup = document.createElementNS(NS, "g");
    labelGroup.setAttribute("class", "map-labels");
    svg.appendChild(mapGroup);
    svg.appendChild(labelGroup);

    tooltip = document.createElement("div");
    tooltip.className = "map-tooltip";
    tooltip.style.opacity = "0";
    container.appendChild(svg);
    container.appendChild(tooltip);

    svg.addEventListener("pointerleave", () => {
      hoverId = null;
      hideTooltip();
      refresh();
    });
  }

  /* ------------------------------------------------------------- data input */

  function setData(features) {
    items = [];
    bounds = computeBounds(features);
    width = BASE_WIDTH;
    height = Math.round(BASE_WIDTH * (bounds.maxLat - bounds.minLat) /
      ((bounds.maxLon - bounds.minLon) * Math.cos(midLat() * Math.PI / 180)));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    mapGroup.innerHTML = "";
    labelGroup.innerHTML = "";

    features.forEach(feature => {
      const id = feature.properties.shapeName;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", geometryToPath(feature.geometry));
      if (!path.getAttribute("d")) return;

      path.dataset.id = id;
      path.classList.add("map-path");
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");

      path.addEventListener("pointerenter", event => {
        hoverId = id;
        refresh();
        raise(id);
        if (event.pointerType !== "touch") showTooltip(event, hooks.getTooltip(feature, id));
      });
      path.addEventListener("pointerdown", event => {
        if (event.pointerType === "touch") showTooltip(event, hooks.getTooltip(feature, id));
      });
      path.addEventListener("pointermove", event => moveTooltip(event));
      path.addEventListener("pointerleave", () => {
        hoverId = null;
        hideTooltip();
        refresh();
      });
      path.addEventListener("click", event => {
        event.stopPropagation();
        hooks.onSelect(id);
      });
      path.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          hooks.onSelect(id);
        }
      });
      path.addEventListener("focus", () => {
        hoverId = id;
        refresh();
        raise(id);
      });
      path.addEventListener("blur", () => {
        hoverId = null;
        refresh();
      });

      mapGroup.appendChild(path);
      items.push({ id, path, feature });
    });

    renderLabels();
    refresh();
  }

  function renderLabels() {
    labelGroup.innerHTML = "";
    items.forEach(item => {
      const text = hooks.getLabel(item.feature, item.id);
      if (!text) return;
      const label = document.createElementNS(NS, "text");
      const box = featureBox(item.feature);
      const size = labelSize(box, text);
      const centroid = projectionCenter(item.feature, box);

      label.setAttribute("x", centroid.x.toFixed(1));
      label.setAttribute("y", centroid.y.toFixed(1));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("class", "district-label");
      label.setAttribute("pointer-events", "none");
      label.dataset.id = item.id;
      label.dataset.size = size.toFixed(1);
      label.dataset.tiny = size < 7.6 ? "1" : "0";
      applyLabelStyle(label, size, false);
      label.textContent = text;
      labelGroup.appendChild(label);
    });
  }

  /** Label typography lives inline so exported SVG/PNG renders identically. */
  function applyLabelStyle(label, size, active) {
    label.style.fontSize = (active ? Math.max(11.5, size) : size).toFixed(1) + "px";
    label.style.fontWeight = active ? "700" : "600";
    label.style.fontFamily = FONT;
    label.style.fill = "#ffffff";
    label.style.paintOrder = "stroke";
    label.style.stroke = "#020617";
    label.style.strokeOpacity = "0.78";
    label.style.strokeWidth = "2px";
    label.style.strokeLinejoin = "round";
    label.style.opacity = active ? "1" : "0.92";
  }

  /* --------------------------------------------------------------- styling */

  /**
   * All paint goes through SVG attributes with explicit hex colours plus separate
   * opacity attributes: rgba()/var() values are not reliable in every renderer
   * (and break canvas export in some browsers).
   */
  function applyStyle(path, style) {
    path.setAttribute("fill", style.fill || "#475569");
    path.setAttribute("fill-opacity", style.fillOpacity === undefined ? 0.9 : style.fillOpacity);
    path.setAttribute("stroke", style.stroke || "#0f172a");
    path.setAttribute("stroke-width", style.strokeWidth === undefined ? 1 : style.strokeWidth);
    path.setAttribute("stroke-opacity", style.strokeOpacity === undefined ? (style.stroke === "none" ? 0 : 0.85) : style.strokeOpacity);
    path.setAttribute("vector-effect", "non-scaling-stroke");
  }

  /** Re-colour every region from current state (no DOM rebuild -> animated fills). */
  function refresh() {
    const activeSelected = plainRender ? null : selectedId;
    const activeHover = plainRender ? null : hoverId;
    items.forEach(({ id, path, feature }) => {
      const style = Object.assign({}, hooks.getStyle(feature, id));
      const isSelected = activeSelected === id;
      const isHover = activeHover === id;

      if (activeSelected) {
        style.fillOpacity = isSelected ? 1 : Math.min(style.fillOpacity, 0.32);
        path.classList.toggle("dimmed", !isSelected);
      } else {
        path.classList.remove("dimmed");
      }
      if (isSelected) {
        style.stroke = accent;
        style.strokeOpacity = 1;
        style.strokeWidth = 3;
      } else if (isHover) {
        style.stroke = "#ffffff";
        style.strokeOpacity = 1;
        style.strokeWidth = 2;
        style.fillOpacity = Math.min((style.fillOpacity || 0) + 0.25, 1);
      }
      applyStyle(path, style);
      path.setAttribute("aria-label", hooks.getLabel ? regionAria(feature, id) : id);
      path.classList.toggle("selected", isSelected);
      path.classList.toggle("focused", isHover);
    });

    labelGroup.classList.toggle("labels-off", !labelsVisible);
    Array.prototype.forEach.call(labelGroup.children, label => {
      const id = label.dataset.id;
      const active = !plainRender && (id === selectedId || id === hoverId);
      label.classList.toggle("active", active);
      const tiny = label.dataset.tiny === "1";
      label.style.display = ((!labelsVisible && !active) || (tiny && !active)) ? "none" : "";
      applyLabelStyle(label, parseFloat(label.dataset.size) || 10, active);
    });
  }

  function regionAria(feature, id) {
    const label = hooks.getLabel(feature, id) || id;
    const tip = hooks.getTooltip(feature, id) || "";
    const plain = tip.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain ? `${label}, ${plain}` : label;
  }

  /** Move a region to the end of the group so its outline is drawn on top. */
  function raise(id) {
    const item = items.find(entry => entry.id === id);
    if (item && item.path.nextSibling !== null) mapGroup.appendChild(item.path);
  }

  /* --------------------------------------------------------------- tooltip */

  function showTooltip(event, html) {
    if (!tooltip || !html) return;
    tooltip.innerHTML = html;
    tooltip.style.opacity = "1";
    moveTooltip(event);
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.opacity = "0";
  }

  function moveTooltip(event) {
    if (!tooltip || !event) return;
    const rect = container.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    let x = event.clientX - rect.left + 16;
    let y = event.clientY - rect.top - 12;
    if (x + box.width > rect.width - 8) x = Math.max(8, event.clientX - rect.left - box.width - 16);
    if (y + box.height > rect.height - 8) y = Math.max(8, rect.height - box.height - 8);
    if (y < 8) y = 8;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  /* ------------------------------------------------------------ projections */

  function computeBounds(features) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    features.forEach(feature => {
      eachRing(feature.geometry, ring => {
        ring.forEach(point => {
          if (point[0] < minLon) minLon = point[0];
          if (point[0] > maxLon) maxLon = point[0];
          if (point[1] < minLat) minLat = point[1];
          if (point[1] > maxLat) maxLat = point[1];
        });
      });
    });
    if (!isFinite(minLon)) return { minLon: 88, maxLon: 93, minLat: 20, maxLat: 27 };
    // small padding so strokes on the coastline are not clipped
    const padLon = (maxLon - minLon) * 0.01;
    const padLat = (maxLat - minLat) * 0.01;
    return {
      minLon: minLon - padLon,
      maxLon: maxLon + padLon,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat
    };
  }

  function midLat() {
    return (bounds.minLat + bounds.maxLat) / 2;
  }

  function project(lon, lat) {
    const lonSpan = bounds.maxLon - bounds.minLon;
    const latSpan = bounds.maxLat - bounds.minLat;
    return {
      x: ((lon - bounds.minLon) / lonSpan) * width,
      y: ((bounds.maxLat - lat) / latSpan) * height
    };
  }

  function eachRing(geometry, fn) {
    if (!geometry) return;
    if (geometry.type === "Polygon") geometry.coordinates.forEach(fn);
    else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach(poly => poly.forEach(fn));
  }

  function geometryToPath(geometry) {
    const parts = [];
    eachRing(geometry, ring => {
      if (!ring || ring.length < 3) return;
      const d = ring.map((point, i) => {
        const p = project(point[0], point[1]);
        return (i === 0 ? "M" : "L") + p.x.toFixed(2) + " " + p.y.toFixed(2);
      }).join(" ");
      parts.push(d + " Z");
    });
    return parts.join(" ");
  }

  /** Screen-space bounding box of a feature. */
  function featureBox(feature) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    eachRing(feature.geometry, ring => {
      ring.forEach(point => {
        const p = project(point[0], point[1]);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  /** Label size that fits inside the district outline. */
  function labelSize(box, text) {
    const chars = Math.max(3, text.length);
    const byHeight = Math.min(box.w, box.h) * 0.3;
    const byWidth = (box.w * 0.94) / (chars * 0.62);
    return Math.max(6, Math.min(13, byHeight, byWidth));
  }

  /** Centroid that always falls inside the shape (largest ring, then inner point). */
  function projectionCenter(feature, box) {
    let biggest = null;
    let biggestArea = -1;
    eachRing(feature.geometry, ring => {
      let area = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      }
      area = Math.abs(area / 2);
      if (area > biggestArea) { biggestArea = area; biggest = ring; }
    });
    if (!biggest) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };

    // polygon centroid (area weighted, unlike a plain vertex average)
    let cx = 0, cy = 0, signed = 0;
    for (let i = 0, j = biggest.length - 1; i < biggest.length; j = i++) {
      const a = biggest[j], b = biggest[i];
      const f = a[0] * b[1] - b[0] * a[1];
      signed += f;
      cx += (a[0] + b[0]) * f;
      cy += (a[1] + b[1]) * f;
    }
    if (Math.abs(signed) < 1e-12) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    signed *= 0.5;
    const c = project(cx / (6 * signed), cy / (6 * signed));
    if (c.x < box.minX || c.x > box.maxX || c.y < box.minY || c.y > box.maxY) {
      return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    }
    return c;
  }

  /* ----------------------------------------------------------------- export */

  /**
   * Standalone SVG markup (no external CSS) for PNG/JPG/PDF export or for saving.
   * @param {Object} options {title, subtitle, legend:[{color,label}], background, text, muted, note}
   */
  function buildExportSVG(options) {
    const opts = options || {};
    // render a neutral map first (no selection dimming / hover highlight)
    plainRender = true;
    refresh();
    try {
      return buildExportSVGInternal(opts);
    } finally {
      plainRender = false;
      refresh();
    }
  }

  function buildExportSVGInternal(opts) {
    const legend = opts.legend || [];
    const legendCols = legend.length > 4 ? 2 : (legend.some(item => item.label.length > 26) ? 2 : 1);
    const legendRows = Math.ceil(legend.length / legendCols) || 1;
    const footerH = 26 + legendRows * LEGEND_ROW + 18;
    const totalH = HEADER_H + height + footerH;
    const legendColW = width / legendCols;
    // long adaptive labels ("সবচেয়ে দুর্বল ২৫% (≤ 16.93%)") must stay inside their column
    const legendChars = Math.max(12, Math.floor((legendColW - 68) / 7.6));

    const out = document.createElementNS(NS, "svg");
    out.setAttribute("xmlns", NS);
    out.setAttribute("viewBox", `0 ${-HEADER_H} ${width} ${totalH}`);
    out.setAttribute("width", width);
    out.setAttribute("height", totalH);
    out.setAttribute("font-family", FONT);

    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", -HEADER_H);
    bg.setAttribute("width", width);
    bg.setAttribute("height", totalH);
    bg.setAttribute("fill", opts.background || "#0f172a");
    out.appendChild(bg);

    const title = document.createElementNS(NS, "text");
    title.setAttribute("x", 34);
    title.setAttribute("y", -92);
    title.setAttribute("fill", opts.text || "#f1f5f9");
    title.setAttribute("font-size", "30");
    title.setAttribute("font-weight", "700");
    title.textContent = opts.title || "";
    out.appendChild(title);

    const subtitle = document.createElementNS(NS, "text");
    subtitle.setAttribute("x", 34);
    subtitle.setAttribute("y", -54);
    subtitle.setAttribute("fill", opts.muted || "#94a3b8");
    subtitle.setAttribute("font-size", "17");
    subtitle.textContent = opts.subtitle || "";
    out.appendChild(subtitle);

    if (opts.note) {
      const note = document.createElementNS(NS, "text");
      note.setAttribute("x", width - 34);
      note.setAttribute("y", -92);
      note.setAttribute("text-anchor", "end");
      note.setAttribute("fill", opts.muted || "#94a3b8");
      note.setAttribute("font-size", "15");
      note.textContent = clip(opts.note, 40);
      out.appendChild(note);
    }

    // copy the live map (paths + labels) with resolved inline styles
    const live = svg.querySelectorAll("path, text");
    const group = document.createElementNS(NS, "g");
    const cloned = [];
    live.forEach(node => {
      const copy = node.cloneNode(true);
      copy.removeAttribute("tabindex");
      copy.removeAttribute("role");
      copy.removeAttribute("class");
      if (copy.tagName.toLowerCase() === "text") {
        // labels keep their inline styles; fill in anything the stylesheet provided
        const computed = window.getComputedStyle(node);
        ["fill", "stroke", "stroke-width", "paint-order", "font-family", "font-size",
          "font-weight", "text-anchor", "dominant-baseline", "opacity"].forEach(prop => {
          if (copy.style.getPropertyValue(prop)) return;
          const value = computed.getPropertyValue(prop);
          if (value && value !== "normal" && value !== "none" && value !== "auto") {
            copy.style.setProperty(prop, value);
          }
        });
      }
      cloned.push(copy);
      group.appendChild(copy);
    });
    out.appendChild(group);

    // legend
    const legendTop = height + 30;
    const colW = legendColW;
    legend.forEach((item, i) => {
      const col = i % legendCols;
      const row = Math.floor(i / legendCols);
      const x = 34 + col * colW;
      const y = legendTop + row * LEGEND_ROW;
      const swatch = document.createElementNS(NS, "rect");
      swatch.setAttribute("x", x);
      swatch.setAttribute("y", y - 13);
      swatch.setAttribute("width", 20);
      swatch.setAttribute("height", 20);
      swatch.setAttribute("rx", 5);
      swatch.setAttribute("fill", item.color);
      swatch.setAttribute("stroke", "rgba(255,255,255,0.35)");
      out.appendChild(swatch);

      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", x + 30);
      text.setAttribute("y", y);
      text.setAttribute("fill", opts.text || "#f1f5f9");
      text.setAttribute("font-size", "15");
      text.textContent = clip(item.label, legendChars);
      out.appendChild(text);
    });

    return {
      markup: new XMLSerializer().serializeToString(out),
      width: width,
      height: totalH
    };
  }

  /** Clip a label to a character budget (keeps exports tidy, no measuring needed). */
  function clip(text, maxChars) {
    const value = String(text === null || text === undefined ? "" : text);
    if (value.length <= maxChars) return value;
    return value.slice(0, Math.max(1, maxChars - 1)).trim() + "…";
  }

  function getSize() {
    return { width, height, ratio: height / width };
  }

  return {
    init,
    setData,
    refresh,
    setSelected(id) { selectedId = id; refresh(); },
    setHovered(id) { hoverId = id; refresh(); },
    getSelected() { return selectedId; },
    setLabelsVisible(visible) { labelsVisible = visible; refresh(); },
    getSize,
    buildExportSVG
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SVGMap;
