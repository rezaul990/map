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

  /* zoom / pan: 1 = the whole map fits the panel, below that it shrinks with a margin */
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 10;
  let view = { k: 1, x: 0, y: 0 };
  let drag = null;
  let pointers = new Map();
  let pinch = null;
  let dragged = false;

  /* ------------------------------------------------------------------ setup */

  function init(options) {
    container = options.container;
    accent = options.accent || accent;
    hooks = {
      getStyle: options.getStyle || (() => ({})),
      getLabel: options.getLabel || (() => ""),
      getTooltip: options.getTooltip || (() => ""),
      onSelect: options.onSelect || (() => {}),
      onZoom: options.onZoom || (() => {})
    };
    container.innerHTML = "";
    container.style.position = "relative";
    container.classList.add("has-svg");

    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "বাংলাদেশের জেলাভিত্তিক কালেকশন ম্যাপ");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.width = "100%";
    svg.style.height = "100%";
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

    attachInteraction();
  }

  /* ----------------------------------------------------------- zoom & pan */

  function attachInteraction() {
    svg.classList.add("map-interactive");

    svg.addEventListener("pointerdown", event => {
      if (event.button !== undefined && event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        dragged = false;
        drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, view: { k: view.k, x: view.x, y: view.y } };
      } else if (pointers.size === 2) {
        drag = null;
        const [a, b] = Array.from(pointers.values());
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), view: { k: view.k, x: view.x, y: view.y } };
      }
      try { svg.setPointerCapture(event.pointerId); } catch (err) { /* jsdom / older browsers */ }
    });

    svg.addEventListener("pointermove", event => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pinch && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance > 0) {
          const centre = toSvgCoords({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
          applyZoom(pinch.view.k * (distance / pinch.distance), centre.x, centre.y, pinch.view);
        }
        dragged = true;
        return;
      }

      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      svg.classList.add("grabbing");
      const perPixel = viewBoxScale();
      view.k = drag.view.k;
      view.x = drag.view.x + dx / perPixel;
      view.y = drag.view.y + dy / perPixel;
      clampView(); // never drag the map out of frame
      hideTooltip();
      applyView();
    });

    const endPointer = event => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && drag.id === event.pointerId) drag = null;
      svg.classList.remove("grabbing");
      // a short tap still counts as a click even if `click` fires later
      if (dragged) setTimeout(() => { dragged = false; }, 0);
    };
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", endPointer);

    svg.addEventListener("wheel", event => {
      event.preventDefault();
      const factor = Math.pow(1.0015, -event.deltaY);
      const centre = toSvgCoords(event);
      applyZoom(view.k * factor, centre.x, centre.y, view);
    }, { passive: false });

    svg.addEventListener("dblclick", event => {
      event.preventDefault();
      const centre = toSvgCoords(event);
      const factor = view.k >= MAX_SCALE - 0.001 ? 0.5 : 1.6;
      applyZoom(view.k * factor, centre.x, centre.y, view);
    });

    // the map is reachable by keyboard as well
    svg.addEventListener("keydown", event => {
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomIn(); }
      else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomOut(); }
      else if (event.key === "0") { event.preventDefault(); resetView(); }
    });
  }

  /**
   * How the viewBox sits inside the element box.
   * The SVG fills its host and letterboxes with preserveAspectRatio="meet", so the
   * rendered map is always as large as the available space allows.
   */
  function metrics() {
    const rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const boxWidth = rect && rect.width ? rect.width : width;
    const boxHeight = rect && rect.height ? rect.height : height;
    const scale = Math.min(boxWidth / width, boxHeight / height) || 1;
    return {
      scale,
      offsetX: (boxWidth - width * scale) / 2,
      offsetY: (boxHeight - height * scale) / 2,
      width: boxWidth,
      height: boxHeight
    };
  }

  function viewBoxScale() {
    return metrics().scale;
  }

  /** Pointer position -> viewBox coordinates (accounts for the letterbox margins). */
  function toSvgCoords(event) {
    const rect = svg.getBoundingClientRect();
    const box = metrics();
    return {
      x: (event.clientX - rect.left - box.offsetX) / box.scale,
      y: (event.clientY - rect.top - box.offsetY) / box.scale
    };
  }

  function clampScale(k) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
  }

  /**
   * Pan limits.
   * k <= 1  -> no panning, the map stays centred (smaller than the frame when zoomed out)
   * k >  1  -> keep the map covering the frame, so there are never empty edges
   */
  function clampView() {
    if (view.k < MIN_SCALE) view.k = MIN_SCALE;
    if (view.k <= 1.0001) {
      view.x = width * (1 - view.k) / 2;
      view.y = height * (1 - view.k) / 2;
      return;
    }
    view.x = Math.min(0, Math.max(width * (1 - view.k), view.x));
    view.y = Math.min(0, Math.max(height * (1 - view.k), view.y));
  }

  /** Zoom so that the given viewBox point stays under the cursor. */
  function applyZoom(targetScale, centreX, centreY, base) {
    const k = clampScale(targetScale);
    if (Math.abs(k - view.k) < 0.0001 && base === view) return;
    const from = base || view;
    const ux = (centreX - from.x) / from.k;
    const uy = (centreY - from.y) / from.k;
    view.k = k;
    view.x = centreX - k * ux;
    view.y = centreY - k * uy;
    clampView();
    applyView();
  }

  function applyView() {
    mapGroup.setAttribute("transform", `translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`);
    const inverse = view.k > 1 ? 1 / view.k : 1;
    Array.prototype.forEach.call(labelGroup.children, label => {
      const bx = Number(label.dataset.bx);
      const by = Number(label.dataset.by);
      if (isNaN(bx) || isNaN(by)) return;
      label.setAttribute("transform", `translate(${bx} ${by}) scale(${inverse.toFixed(4)})`);
    });
    svg.classList.toggle("zoomed", view.k > 1.001);
    hooks.onZoom(view.k, view.k > 1.001);
  }

  function zoomIn(step) {
    applyZoom(view.k * (step || 1.5), width / 2, height / 2, view);
  }

  function zoomOut(step) {
    applyZoom(view.k / (step || 1.5), width / 2, height / 2, view);
  }

  function resetView() {
    view = { k: 1, x: 0, y: 0 };
    applyView();
  }

  /** Grow the panel to fill the viewport (used by the expand button). */
  function setExpanded(expanded) {
    if (!container) return;
    const panel = container.closest(".map-container") || container;
    panel.classList.toggle("map-expanded", !!expanded);
    document.body.classList.toggle("map-expanded-open", !!expanded);
    const button = document.getElementById("mapExpand");
    if (button) {
      button.setAttribute("aria-pressed", String(!!expanded));
      button.setAttribute("aria-label", expanded ? "ম্যাপ ছোট করুন" : "ম্যাপ বড় করুন");
    }
  }

  function isExpanded() {
    if (!container) return false;
    const panel = container.closest(".map-container") || container;
    return panel.classList.contains("map-expanded");
  }

  /** Frame a district (or the whole map) by its bounding box. */
  function zoomToShape(id, padding) {
    if (!id) { resetView(); return; }
    const item = items.find(entry => entry.id === id);
    if (!item) return;
    const box = featureBox(item.feature);
    const pad = padding === undefined ? 0.18 : padding;
    const boxW = Math.max(box.w, 1) * (1 + pad);
    const boxH = Math.max(box.h, 1) * (1 + pad);
    const k = clampScale(Math.min(width / boxW, height / boxH, MAX_SCALE));
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;
    view.k = k;
    view.x = width / 2 - k * centreX;
    view.y = height / 2 - k * centreY;
    clampView();
    applyView();
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
        if (dragged) return; // the pointer was panning, not selecting
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
    view = { k: 1, x: 0, y: 0 };
    applyView();
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

      label.dataset.bx = centroid.x.toFixed(1);
      label.dataset.by = centroid.y.toFixed(1);
      label.setAttribute("x", "0");
      label.setAttribute("y", "0");
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

  /**
   * Label size that fits inside the district outline.
   * Bengali glyphs run wider than Latin ones, so they get a larger per-character
   * budget; otherwise names like নারায়ণগঞ্জ would overflow their district.
   */
  function labelSize(box, text) {
    const chars = Math.max(3, text.length);
    const perChar = /[\u0980-\u09FF]/.test(text) ? 0.74 : 0.62;
    const byHeight = Math.min(box.w, box.h) * 0.34;
    const byWidth = (box.w * 0.98) / (chars * perChar);
    return Math.max(6, Math.min(14, byHeight, byWidth));
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


  /** Create an SVG text node with the export font applied explicitly. */
  function exportText(opts, attrs, content) {
    const node = document.createElementNS(NS, "text");
    node.setAttribute("font-family", FONT);
    Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key]));
    node.textContent = content;
    return node;
  }

  function buildExportSVGInternal(opts) {
    const legend = opts.legend || [];
    const legendCols = legend.length > 4 ? 2 : (legend.some(item => item.label.length > 26) ? 2 : 1);
    const legendRows = Math.ceil(legend.length / legendCols) || 1;
    const footerH = 26 + legendRows * LEGEND_ROW + 18;
    const totalH = HEADER_H + height + footerH;
    const legendColW = width / legendCols;
    // long adaptive labels ("সবচেয়ে দুর্বল ২৫% (16.93% বা কম)") must stay inside their column
    const legendChars = Math.max(12, Math.floor((legendColW - 68) / 7.6));

    const out = document.createElementNS(NS, "svg");
    out.setAttribute("xmlns", NS);
    if (opts.fontCss) {
      // fonts must travel inside the file: an SVG loaded as an <img> cannot fetch them
      const style = document.createElementNS(NS, "style");
      style.textContent = opts.fontCss;
      out.appendChild(style);
    }
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

    out.appendChild(exportText(opts, {
      x: 34, y: -92, fill: opts.text || "#f1f5f9", "font-size": "30", "font-weight": "700"
    }, opts.title || ""));

    out.appendChild(exportText(opts, {
      x: 34, y: -54, fill: opts.muted || "#94a3b8", "font-size": "17"
    }, opts.subtitle || ""));

    if (opts.note) {
      out.appendChild(exportText(opts, {
        x: width - 34, y: -92, "text-anchor": "end",
        fill: opts.muted || "#94a3b8", "font-size": "15"
      }, clip(opts.note, 40)));
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
        // drop the on-screen zoom counter-scale: exports always show the full map
        if (copy.dataset && copy.dataset.bx !== undefined) {
          copy.setAttribute("transform", `translate(${copy.dataset.bx} ${copy.dataset.by})`);
          ["bx", "by", "size", "tiny", "id"].forEach(key => delete copy.dataset[key]);
        }
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

      out.appendChild(exportText(opts, {
        x: x + 30, y: y, fill: opts.text || "#f1f5f9", "font-size": "15"
      }, clip(item.label, legendChars)));
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
    zoomIn,
    zoomOut,
    resetView,
    zoomToShape,
    setExpanded,
    isExpanded,
    getZoom() { return view.k; },
    setSelected(id) { selectedId = id; refresh(); },
    setHovered(id) { hoverId = id; refresh(); },
    getSelected() { return selectedId; },
    setLabelsVisible(visible) { labelsVisible = visible; refresh(); },
    getSize,
    buildExportSVG
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SVGMap;
