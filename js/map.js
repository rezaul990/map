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
  let pathGroup = null;
  let heatGroup = null;
  let plazaGroup = null;
  let labelGroup = null;
  let tooltip = null;
  let hooks = {};
  let items = [];
  let plazaList = [];
  let plazaItems = [];
  let plazasVisible = true;
  let hoverPlazaId = null;
  let litPlazaId = null;
  let bounds = null;
  let width = BASE_WIDTH;
  let height = 1000;
  let selectedId = null;
  let hoverId = null;
  let labelsVisible = true;
  let accent = "#38bdf8";
  let plainRender = false;
  let heatVisible = false;
  let heatRenderKey = "";

  /* zoom / pan: 1 = the whole map fits the panel, below that it shrinks with a margin */
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 10;

  /*
   * Plaza markers.
   *
   * The report carries no latitude/longitude, so a plaza cannot be pinned to a real
   * street address. Each plaza of a district is therefore given a deterministic slot
   * inside that district outline: candidate points on a grid, then farthest-point
   * sampling, so the dots spread over the district, never stack on each other and stay
   * the same from one report to the next (same plaza list in -> same layout out).
   */
  const PLAZA = {
    dense: 20,          // candidate points per plaza (grid resolution)
    minStep: 0.7,       // grid step floor, map units
    pad: 0.5,           // keep dots off the district border, map units
    spacing: 0.5,       // radius <= half the distance to the closest neighbour
    minRadius: 1,
    maxRadius: 3,
    loneRadius: 2.2,    // single-plaza districts have no neighbour to respect
    screenRadius: 3.2,  // target radius in device px (dots stop growing when zoomed in)
    hitScale: 2.2       // invisible hover target, relative to the dot
  };
  let view = { k: 1, x: 0, y: 0 };
  let drag = null;
  let pointers = new Map();
  let pinch = null;
  let dragged = false;
  let boxState = "";

  /*
   * Geometry of the drawing box, owned by JavaScript.
   *
   * CSS positions the box too (and index.html repeats it inline for the no-script
   * case), but this module used to write `position: relative` on the box, which
   * silently cancelled the stylesheet: the box stopped being pinned to the panel,
   * its height fell back to the content and the svg dropped to its intrinsic
   * 300x150 size. That is the "the map is a small block" report. Inline styles beat
   * every stylesheet — cached, stale or missing — so the geometry is applied from
   * here and re-applied whenever the state or the viewport changes.
   */
  const BOX = {
    base: { top: 40, right: 6, bottom: 6, left: 6 },
    expanded: { top: 44, right: 10, bottom: 8, left: 10 },
    compact: { top: 38, right: 4, bottom: 4, left: 4 },
    short: { top: 36, right: 6, bottom: 6, left: 6 }
  };

  function mediaMatches(query) {
    try {
      return typeof window !== "undefined" && typeof window.matchMedia === "function"
        && window.matchMedia(query).matches === true;
    } catch (err) {
      return false;
    }
  }

  function boxGeometry() {
    if (container && container.closest && container.closest(".map-expanded")) return BOX.expanded;
    if (mediaMatches("(max-width: 720px)")) return BOX.compact;
    if (mediaMatches("(max-height: 720px)")) return BOX.short;
    return BOX.base;
  }

  function applyBox() {
    if (!container || !container.style) return false;
    const geometry = boxGeometry();
    const key = [geometry.top, geometry.right, geometry.bottom, geometry.left].join("/");
    if (key === boxState) return false;
    boxState = key;
    container.style.position = "absolute";
    container.style.top = geometry.top + "px";
    container.style.right = geometry.right + "px";
    container.style.bottom = geometry.bottom + "px";
    container.style.left = geometry.left + "px";
    return true;
  }

  /* ------------------------------------------------------------------ setup */

  function init(options) {
    container = options.container;
    accent = options.accent || accent;
    hooks = {
      getStyle: options.getStyle || (() => ({})),
      getLabel: options.getLabel || (() => ""),
      getTooltip: options.getTooltip || (() => ""),
      onSelect: options.onSelect || (() => {}),
      onZoom: options.onZoom || (() => {}),
      getPlazaStyle: options.getPlazaStyle || (() => ({})),
      getPlazaTooltip: options.getPlazaTooltip || (() => ""),
      onPlazaSelect: options.onPlazaSelect || (() => {}),
      getHeatColor: options.getHeatColor || (() => "#991b1b")
    };
    container.innerHTML = "";
    container.classList.add("has-svg");
    applyBox();

    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "বাংলাদেশের জেলাভিত্তিক কালেকশন ম্যাপ");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    // percentage attributes (not pixels) so the map always fills its host, even if a
    // cached stylesheet is missing the corresponding CSS rules
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.classList.add("bd-map");
    mapGroup = document.createElementNS(NS, "g");
    mapGroup.setAttribute("class", "map-view");
    pathGroup = document.createElementNS(NS, "g");
    pathGroup.setAttribute("class", "map-paths");
    heatGroup = document.createElementNS(NS, "g");
    heatGroup.setAttribute("class", "map-heat-layer");
    heatGroup.setAttribute("aria-hidden", "true");
    heatGroup.setAttribute("pointer-events", "none");
    plazaGroup = document.createElementNS(NS, "g");
    plazaGroup.setAttribute("class", "map-plazas");
    labelGroup = document.createElementNS(NS, "g");
    labelGroup.setAttribute("class", "map-labels");
    mapGroup.appendChild(heatGroup);
    mapGroup.appendChild(pathGroup);
    mapGroup.appendChild(plazaGroup);
    mapGroup.appendChild(labelGroup);
    svg.appendChild(mapGroup);

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

    // re-evaluate the box geometry and the label legibility when the panel changes
    // size (the observer only re-renders: it never sizes the svg, so it cannot feed
    // back into layout)
    if (typeof ResizeObserver !== "undefined" && svg) {
      const observer = new ResizeObserver(() => {
        applyBox();
        hooks.onZoom(view.k, view.k > 1.001, applyLabelLegibility() === true);
      });
      observer.observe(svg);
    }

    // the compact/short-viewport geometry is chosen by media queries, so react to
    // them explicitly (older engines have no addEventListener on MediaQueryList)
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", () => {
        if (applyBox()) hooks.onZoom(view.k, view.k > 1.001, applyLabelLegibility() === true);
      });
    }
    ["(max-width: 720px)", "(max-height: 720px)"].forEach(query => {
      try {
        const list = window.matchMedia && window.matchMedia(query);
        const onChange = () => {
          if (applyBox()) hooks.onZoom(view.k, view.k > 1.001, applyLabelLegibility() === true);
        };
        if (list && list.addEventListener) list.addEventListener("change", onChange);
        else if (list && list.addListener) list.addListener(onChange);
      } catch (err) { /* no media query support: the base geometry is fine */ }
    });
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

    // Ctrl/⌘ + wheel zooms; a plain wheel scrolls the page. (Wheel-only zoom used to
    // shrink the map whenever someone scrolled past it with the cursor on the panel.)
    svg.addEventListener("wheel", event => {
      if (!event.ctrlKey && !event.metaKey) return;
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
    // One transform for the whole view: shapes and labels move together, and zooming
    // in magnifies everything - including the district names, which is how they become
    // readable on a small panel. Names that are still too small are hidden below.
    mapGroup.setAttribute("transform", `translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`);

    svg.classList.toggle("zoomed", view.k > 1.001);
    const namesHidden = applyLabelLegibility() === true;
    hooks.onZoom(view.k, view.k > 1.001, namesHidden);
  }

  /** Names rasterising below this many device pixels are hidden instead of drawn as mush. */
  const MIN_READABLE_LABEL_PX = 6.5;

  /**
   * Hide district names that would be too small to read.
   *
   * The effective size is the label's size in viewBox units times how many device
   * pixels one unit currently occupies (element fit x view scale). Zooming in,
   * enlarging the panel or expanding to full screen brings the names back.
   */
  function applyLabelLegibility() {
    if (!labelGroup) return;
    const box = metrics();
    if (!box.scale || box.scale < 0.05) return; // no usable measurement (headless, hidden panel)

    const pixelsPerUnit = box.scale * view.k;
    let visible = 0;
    Array.prototype.forEach.call(labelGroup.children, label => {
      const size = Number(label.dataset.size) || 10;
      // districts that only just fit their name need a little more room than the rest
      const threshold = label.dataset.tiny === "1"
        ? MIN_READABLE_LABEL_PX + 2
        : MIN_READABLE_LABEL_PX;
      const tooSmall = size * pixelsPerUnit < threshold;
      label.classList.toggle("too-small", tooSmall);
      if (!tooSmall) visible++;
    });
    const allHidden = visible === 0;
    labelGroup.classList.toggle("all-hidden", allHidden);
    return allHidden;
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
    applyBox();
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
    const proj = makeProjection(features);
    bounds = proj.bounds;
    width = proj.width;
    height = proj.height;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    pathGroup.innerHTML = "";
    if (heatGroup) heatGroup.innerHTML = "";
    heatRenderKey = "";
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

      pathGroup.appendChild(path);
      items.push({ id, path, feature });
    });

    renderLabels();
    renderPlazas();
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

    refreshPlazas();
  }

  function regionAria(feature, id) {
    const label = hooks.getLabel(feature, id) || id;
    const tip = hooks.getTooltip(feature, id) || "";
    const plain = tip.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain ? `${label}, ${plain}` : label;
  }

  /** Move a region to the end of the path layer so its outline is drawn on top. */
  function raise(id) {
    const item = items.find(entry => entry.id === id);
    if (item && item.path !== pathGroup.lastChild) pathGroup.appendChild(item.path);
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

  /** Projection for a feature set: the same maths setData() uses for the live map. */
  function makeProjection(features) {
    const box = computeBounds(features);
    return {
      bounds: box,
      width: BASE_WIDTH,
      height: Math.round(BASE_WIDTH * (box.maxLat - box.minLat) /
        ((box.maxLon - box.minLon) * Math.cos(((box.minLat + box.maxLat) / 2) * Math.PI / 180)))
    };
  }

  function projectIn(proj, lon, lat) {
    const lonSpan = proj.bounds.maxLon - proj.bounds.minLon;
    const latSpan = proj.bounds.maxLat - proj.bounds.minLat;
    return {
      x: ((lon - proj.bounds.minLon) / lonSpan) * proj.width,
      y: ((proj.bounds.maxLat - lat) / latSpan) * proj.height
    };
  }

  function project(lon, lat) {
    return projectIn({ bounds, width, height }, lon, lat);
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
    const byHeight = Math.min(box.w, box.h) * 0.38;
    const byWidth = (box.w * 0.98) / (chars * perChar);
    return Math.max(6, Math.min(17, byHeight, byWidth));
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

  /* ---------------------------------------------------------- plaza markers */

  /** Projected rings of one feature, ready for point-in-polygon tests. */
  function projectedRings(feature, proj) {
    const rings = [];
    eachRing(feature.geometry, ring => {
      if (!ring || ring.length < 3) return;
      rings.push(ring.map(point => projectIn(proj, point[0], point[1])));
    });
    return rings;
  }

  function ringsBox(rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rings.forEach(ring => ring.forEach(point => {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }));
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  /** Even-odd point-in-polygon across every ring: holes and islands included. */
  function pointInRings(rings, x, y) {
    let crossings = 0;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) crossings++;
      }
    }
    return crossings % 2 === 1;
  }

  /** Inside the district and at least `margin` away from every edge. */
  function pointInRingsWithMargin(rings, x, y, margin) {
    if (!pointInRings(rings, x, y)) return false;
    if (!margin) return true;
    const o = margin * 0.7;
    return pointInRings(rings, x + margin, y) && pointInRings(rings, x - margin, y) &&
      pointInRings(rings, x, y + margin) && pointInRings(rings, x, y - margin) &&
      pointInRings(rings, x + o, y + o) && pointInRings(rings, x - o, y + o) &&
      pointInRings(rings, x + o, y - o) && pointInRings(rings, x - o, y - o);
  }

  /** Candidate slots inside one district: a grid that gets denser as it needs more dots. */
  function candidatePoints(rings, box, count) {
    const area = Math.max(1, box.w * box.h);
    const step = Math.max(PLAZA.minStep, Math.sqrt(area / (count * PLAZA.dense)));
    const margins = [
      Math.min(PLAZA.pad, step * 0.6),
      Math.min(PLAZA.pad, step * 0.6) * 0.4,
      0
    ];
    for (let pass = 0; pass < margins.length; pass++) {
      const margin = margins[pass];
      const points = [];
      for (let x = box.minX + step / 2; x < box.maxX; x += step) {
        for (let y = box.minY + step / 2; y < box.maxY; y += step) {
          if (pointInRingsWithMargin(rings, x, y, margin)) points.push({ x, y });
        }
      }
      if (points.length) return points;
    }
    // degenerate district (very thin or a speck): fall back to its own middle
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return pointInRings(rings, cx, cy) ? [{ x: cx, y: cy }] : [];
  }

  /**
   * Farthest-point sampling: pick the candidate nearest the middle first, then always
   * the candidate that is farthest from everything picked so far. Deterministic, and it
   * spreads the dots over the whole district instead of letting them bunch up.
   */
  function spreadPoints(candidates, count, box) {
    if (candidates.length <= count) return candidates.slice();
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    let seed = 0;
    let best = Infinity;
    candidates.forEach((point, index) => {
      const d = (point.x - cx) * (point.x - cx) + (point.y - cy) * (point.y - cy);
      if (d < best) { best = d; seed = index; }
    });

    const chosen = [candidates[seed]];
    const dist = candidates.map(point => Math.hypot(point.x - candidates[seed].x, point.y - candidates[seed].y));
    dist[seed] = -1;
    while (chosen.length < count) {
      let pick = -1;
      let farthest = -1;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] > farthest) { farthest = dist[i]; pick = i; }
      }
      if (pick < 0) break;
      chosen.push(candidates[pick]);
      dist[pick] = -1;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < 0) continue;
        const d = Math.hypot(candidates[i].x - candidates[pick].x, candidates[i].y - candidates[pick].y);
        if (d < dist[i]) dist[i] = d;
      }
    }
    return chosen;
  }

  /** Dot radius that keeps the closest pair of dots from touching. */
  function plazaRadius(points) {
    if (points.length < 2) return PLAZA.loneRadius;
    let closest = Infinity;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        if (d < closest) closest = d;
      }
    }
    if (!isFinite(closest)) return PLAZA.loneRadius;
    return Math.max(PLAZA.minRadius, Math.min(PLAZA.maxRadius, closest * PLAZA.spacing));
  }

  /**
   * Positions for every plaza, grouped per district.
   * @param {Array} features geojson features (one per district)
   * @param {Object} groups {shapeName: [plaza, ...]} - order is kept in the result
   * @returns {Map} shapeName -> {radius, points:[{x,y}]}
   */
  function planPlazaPositions(features, groups) {
    const proj = makeProjection(features || []);
    const plan = new Map();
    (features || []).forEach(feature => {
      const shape = feature.properties.shapeName;
      const names = groups ? groups[shape] : null;
      if (!names || !names.length) return;
      const rings = projectedRings(feature, proj);
      if (!rings.length) return;
      const box = ringsBox(rings);
      const points = spreadPoints(candidatePoints(rings, box, names.length), names.length, box);
      if (!points.length) return;
      plan.set(shape, { radius: plazaRadius(points), points });
    });
    return plan;
  }

  /** Rebuild the marker layer from the last list handed to setPlazas(). */
  function renderPlazas() {
    if (!plazaGroup) return;
    plazaGroup.innerHTML = "";
    plazaItems = [];
    if (!plazaList.length || !items.length) return;

    const features = items.map(item => item.feature);
    const known = new Set(items.map(item => item.id));
    const groups = {};
    plazaList.forEach(entry => {
      const shape = entry.shape;
      if (!shape || !known.has(shape)) return;
      (groups[shape] || (groups[shape] = [])).push(entry);
    });
    // name order, so the same list always produces the same picture
    Object.keys(groups).forEach(shape => {
      groups[shape].sort((a, b) => String(a.label).localeCompare(String(b.label)));
    });

    const plan = planPlazaPositions(features, groups);

    Object.keys(groups).forEach(shape => {
      const layout = plan.get(shape);
      if (!layout) return;
      groups[shape].forEach((entry, index) => {
        const point = layout.points[index];
        if (!point) return;

        const node = document.createElementNS(NS, "g");
        node.setAttribute("class", "map-plaza-item");
        node.dataset.plaza = entry.id;
        node.dataset.shape = shape;

        // invisible, larger twin: a 2px dot is not a comfortable hover target
        const hit = document.createElementNS(NS, "circle");
        hit.setAttribute("class", "map-plaza-hit");
        hit.setAttribute("cx", point.x.toFixed(2));
        hit.setAttribute("cy", point.y.toFixed(2));
        // painted, but invisible: `fill="transparent"` is not hit-testable in every engine
        hit.setAttribute("fill", "#000000");
        hit.setAttribute("fill-opacity", "0");

        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("class", "map-plaza");
        dot.setAttribute("cx", point.x.toFixed(2));
        dot.setAttribute("cy", point.y.toFixed(2));
        dot.setAttribute("vector-effect", "non-scaling-stroke");

        node.appendChild(hit);
        node.appendChild(dot);
        plazaGroup.appendChild(node);

        entry.shape = shape;
        plazaItems.push({
          id: entry.id,
          shape,
          entry,
          node,
          dot,
          hit,
          x: point.x,
          y: point.y,
          baseRadius: layout.radius,
          styled: ""
        });
      });
    });

    attachPlazaPicker();
    renderHeat();
  }

  /**
   * One pointer handler for the whole layer.
   *
   * The hit areas have to be much larger than a 2px dot, so in a dense district
   * (Dhaka alone holds 79 plazas) they overlap, and letting the browser pick whichever
   * shape is on top would name the wrong plaza. Instead the layer resolves the dot the
   * pointer is *nearest to* — that is the one the user means.
   */
  function nearestPlaza(event) {
    if (!plazaItems.length) return null;
    const point = toSvgCoords(event);
    const x = (point.x - view.x) / view.k;
    const y = (point.y - view.y) / view.k;
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < plazaItems.length; i++) {
      const item = plazaItems[i];
      const d = Math.hypot(item.x - x, item.y - y);
      if (d < bestDistance) { bestDistance = d; best = item; }
    }
    if (!best) return null;
    const reach = Number(best.hit.getAttribute("r")) || 0;
    // inside the dot's own hover target, and not simply the closest of two far-away dots
    return bestDistance <= reach + (view.k > 0 ? 2 / view.k : 0) ? best : null;
  }

  function hoverPlaza(item, event) {
    const id = item ? item.id : null;
    if (id === hoverPlazaId) {
      if (item) moveTooltip(event);
      return;
    }
    hoverPlazaId = id;
    refresh();
    if (item) showTooltip(event, hooks.getPlazaTooltip(item.entry));
    else hideTooltip();
  }

  function attachPlazaPicker() {
    if (!plazaGroup || plazaGroup.dataset.picker === "1") return;
    plazaGroup.dataset.picker = "1";

    plazaGroup.addEventListener("pointermove", event => hoverPlaza(nearestPlaza(event), event));
    plazaGroup.addEventListener("pointerleave", () => hoverPlaza(null));
    plazaGroup.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch") return;
      const item = nearestPlaza(event);
      if (item) showTooltip(event, hooks.getPlazaTooltip(item.entry));
    });
    plazaGroup.addEventListener("click", event => {
      if (dragged) return; // the pointer was panning, not picking a plaza
      const item = nearestPlaza(event);
      if (!item) return;
      event.stopPropagation();
      hooks.onPlazaSelect(item.entry);
    });
  }

  function setPlazas(list) {
    plazaList = Array.isArray(list) ? list.filter(entry => entry && entry.id && entry.shape) : [];
    renderPlazas();
    refresh();
  }

  /** Dot size and paint. Only dots whose state actually changed are touched. */
  function refreshPlazas() {
    if (!plazaGroup) return;
    const visible = plazasVisible && plazaItems.length > 0;
    const display = visible ? "" : "none";
    if (plazaGroup.style.display !== display) plazaGroup.style.display = display;
    if (!plazaItems.length) return;

    const box = metrics();
    const zoom = plainRender ? 1 : view.k;
    // dots keep a steady size on screen; they only shrink in map units, never grow into blobs
    const perUnit = 1 / Math.max(0.0001, box.scale * zoom);
    const screenRadius = PLAZA.screenRadius * perUnit;
    const activeSelected = plainRender ? null : selectedId;
    const activeHover = plainRender ? null : hoverPlazaId;
    const activeLit = plainRender ? null : litPlazaId;

    plazaItems.forEach(item => {
      const hot = item.id === activeHover || item.id === activeLit;
      const dimmed = activeSelected ? item.shape !== activeSelected : false;
      const radius = Math.min(item.baseRadius, screenRadius) * (hot ? 1.5 : 1);
      const style = hooks.getPlazaStyle(item.entry) || {};
      // in heatmap mode the weather field carries the colour; dots stay as hover targets
      const hidden = heatVisible && !hot;
      const key = [radius.toFixed(2), hot ? 1 : 0, dimmed ? 1 : 0, hidden ? 1 : 0,
        style.fill, style.stroke, style.fillOpacity, style.strokeOpacity].join("|");
      if (key === item.styled) return;
      item.styled = key;

      item.dot.setAttribute("r", radius.toFixed(2));
      item.hit.setAttribute("r", (radius * PLAZA.hitScale).toFixed(2));
      item.dot.setAttribute("fill", hot ? accent : (style.fill || "#e2e8f0"));
      item.dot.setAttribute("fill-opacity", hidden ? 0 : dimmed ? 0.25 : (style.fillOpacity === undefined ? 1 : style.fillOpacity));
      item.dot.setAttribute("stroke", hot ? "#ffffff" : (style.stroke || "#0f172a"));
      item.dot.setAttribute("stroke-opacity", hidden ? 0 : hot ? 1 : (style.strokeOpacity === undefined ? 0.85 : style.strokeOpacity));
      item.dot.setAttribute("stroke-width", hot ? 1.6 : (style.strokeWidth === undefined ? 1 : style.strokeWidth));
      item.dot.classList.toggle("lit", hot);
      // the dot under the pointer sits on top of its neighbours
      if (hot && plazaGroup.lastElementChild !== item.node) plazaGroup.appendChild(item.node);
    });
  }

  /* ---------------------------------------------------------------- heatmap */

  /**
   * Weather-style Running Month Overdue field: every plaza contributes a soft blob
   * tinted by its normalised value, so the map reads like a temperature overlay.
   * Canvas is used when available (and travels into the export as an <image>); a
   * plain SVG fallback keeps jsdom and old engines working.
   */
  function setHeatmapVisible(visible) {
    heatVisible = !!visible;
    if (svg) svg.classList.toggle("heatmap-on", heatVisible);
    renderHeat();
    refresh();
  }

  function heatPoints() {
    return plazaItems.filter(item => {
      const value = item.entry ? item.entry.heat : null;
      return value !== null && value !== undefined && !isNaN(value);
    });
  }

  function heatColor(value) {
    const color = hooks.getHeatColor(value);
    return typeof color === "string" && color ? color : "#991b1b";
  }

  function heatRadius() {
    // small enough to keep neighbouring plazas distinguishable, large enough to blend
    return Math.max(14, Math.min(width, height) * 0.042);
  }

  function renderHeat() {
    if (!heatGroup) return;
    const points = heatVisible ? heatPoints() : [];
    const key = points.map(item =>
      `${item.x.toFixed(1)},${item.y.toFixed(1)},${Number(item.entry.heat).toFixed(3)}`
    ).join(";");
    if (key === heatRenderKey) return;
    heatRenderKey = key;
    heatGroup.innerHTML = "";
    if (!points.length) return;
    const ordered = points.slice().sort((a, b) => a.entry.heat - b.entry.heat);
    const image = buildHeatImage(ordered);
    if (image) heatGroup.appendChild(image);
    else buildHeatFallback(ordered);
  }

  function buildHeatImage(points) {
    let canvas = null;
    let ctx = null;
    try {
      canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(width * 2));
      canvas.height = Math.max(2, Math.round(height * 2));
      ctx = canvas.getContext("2d");
    } catch (err) {
      return null;
    }
    if (!ctx) return null;

    const scaleX = canvas.width / width;
    const scaleY = canvas.height / height;
    const radius = heatRadius() * Math.max(scaleX, scaleY);

    points.forEach(item => {
      const cx = item.x * scaleX;
      const cy = item.y * scaleY;
      const hex = heatColor(item.entry.heat);
      // hotter plazas burn brighter, so the red hotspots stay specific
      const strength = 0.3 + 0.45 * item.entry.heat;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, hexToRgba(hex, strength));
      gradient.addColorStop(0.5, hexToRgba(hex, strength * 0.55));
      gradient.addColorStop(1, hexToRgba(hex, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    let href = "";
    try { href = canvas.toDataURL("image/png"); } catch (err) { return null; }
    if (!href || href.indexOf("data:image") !== 0) return null;

    const image = document.createElementNS(NS, "image");
    image.setAttribute("class", "map-heat-image");
    image.setAttribute("x", "0");
    image.setAttribute("y", "0");
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("opacity", "0.92");
    image.setAttribute("pointer-events", "none");
    image.setAttribute("href", href);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
    return image;
  }

  function buildHeatFallback(points) {
    const radius = heatRadius();
    points.forEach(item => {
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("class", "map-heat");
      circle.setAttribute("cx", item.x.toFixed(2));
      circle.setAttribute("cy", item.y.toFixed(2));
      circle.setAttribute("r", radius.toFixed(2));
      circle.setAttribute("fill", heatColor(item.entry.heat));
      circle.setAttribute("fill-opacity", (0.18 + 0.22 * item.entry.heat).toFixed(2));
      circle.setAttribute("stroke", "none");
      circle.setAttribute("pointer-events", "none");
      heatGroup.appendChild(circle);
    });
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || "").replace("#", "");
    if (value.length !== 6) return `rgba(153, 27, 27, ${alpha})`;
    const num = parseInt(value, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
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
    // long labels ("15,00,000 – 39,99,999") must stay inside their column
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

    // copy the live map (paths + labels + plaza dots) with resolved inline styles
    const live = svg.querySelectorAll("path, text, circle.map-plaza, image.map-heat-image, circle.map-heat");
    const group = document.createElementNS(NS, "g");
    const cloned = [];
    live.forEach(node => {
      if (!plazasVisible && node.classList && node.classList.contains("map-plaza")) return;
      const copy = node.cloneNode(true);
      copy.removeAttribute("tabindex");
      copy.removeAttribute("role");
      copy.removeAttribute("class");
      if (copy.tagName.toLowerCase() === "text") {
        if (copy.dataset && copy.dataset.bx !== undefined) {
          // older markup kept anchors in data-*; normalise to plain coordinates
          copy.setAttribute("x", copy.dataset.bx);
          copy.setAttribute("y", copy.dataset.by);
        }
        if (copy.dataset) ["bx", "by", "size", "tiny"].forEach(key => delete copy.dataset[key]);
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
    setPlazas,
    setPlazasVisible(visible) { plazasVisible = !!visible; refresh(); },
    setHeatmapVisible,
    setPlazaHighlight(id) { litPlazaId = id || null; refresh(); },
    getPlazaCount() { return plazaItems.length; },
    planPlazaPositions,
    applyBox,
    getSize,
    buildExportSVG
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SVGMap;
