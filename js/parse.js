/**
 * Sheet parsing + district aggregation.
 *
 * Everything in this file is pure logic (no DOM), so it can be unit tested with Node:
 * a spreadsheet row array in -> normalised plaza records + district stats out.
 */
const PlazaParser = (() => {
  /**
   * Column index used by the original 26-column "hireTargetAccAll" export.
   * Only used as a fallback when a column cannot be identified from the header row,
   * so reports with extra/removed columns keep working.
   */
  const LEGACY_INDEX = {
    plaza: 7,
    collectableQty: 9,
    collectedQty: 10,
    qtyPct: 11,
    collectableAmt: 13,
    collectedAmt: 16,
    advance: 18,
    totalCollection: 19,
    amtPct: 20,
    prevOverdue: 21,
    runningOverdue: 23,
    overdueChange: 25
  };

  /** Header detection rules, evaluated in this order. */
  const FIELDS = [
    { key: "plaza", any: [/^plaza(\s*(name|code))?$/] },
    { key: "district", any: [/(district|zila|jela|জেলা)/], not: /plaza|area/ },
    { key: "area", any: [/^area$/] },
    { key: "qtyPct", any: [/collectable\s*(vs\.?|versus).{0,24}qty/, /collectable.{0,32}qty.{0,12}%\)?/, /^(collected|recovery).{0,20}%\s*$/] },
    { key: "amtPct", any: [/collectable\s*(vs\.?|versus).{0,24}(amt|amount)/, /collectable.{0,32}(amt|amount).{0,12}%\)?/] },
    { key: "prevOverdue", any: [/overdue/], not: /(running|closing|current|end|increase|decrease|change)/ },
    { key: "runningOverdue", any: [/overdue/], not: /(increase|decrease|change)/ },
    { key: "overdueChange", any: [/overdue.{0,24}(increase|decrease|change)/, /(increase|decrease).{0,12}overdue/] },
    { key: "totalCollection", any: [/total.{0,16}(collect|recovery|deposit)/] },
    { key: "collectableQty", any: [/collectable.{0,20}qty/], not: /(vs|versus|%|percent)/ },
    { key: "collectedQty", any: [/^(collected|collection).{0,20}qty/], not: /(vs|versus|%|percent|total)/ },
    { key: "collectableAmt", any: [/collectable.{0,20}(amt|amount)/], not: /(vs|versus|%|percent)/ },
    { key: "collectedAmt", any: [/^(collected|collection).{0,20}(amt|amount)/], not: /(vs|versus|%|percent|total)/ },
    { key: "advance", any: [/advance/] }
  ];

  const NUMERIC_FIELDS = [
    "collectableQty", "collectedQty", "qtyPct",
    "collectableAmt", "collectedAmt", "amtPct",
    "advance", "totalCollection",
    "prevOverdue", "runningOverdue", "overdueChange"
  ];

  /**
   * The three report metrics and the raw columns behind each one:
   *
   *   Qty     -> Collectable Acc. Qty. / Collected Acc. Qty. / Collectable Vs. Collected Acc Qty (%)
   *   Amt     -> Collectable Amt.      / Collected Amt.      / Collectable Vs. Collected Amt (%)
   *   Overdue -> Previous Month Overdue / Running Month Overdue / Overdue Increase/(Decrease)
   */
  const METRIC_GROUPS = {
    collectedQty: { base: "collectableQty", collected: "collectedQty", pct: "qtyPct" },
    collectableAmt: { base: "collectableAmt", collected: "collectedAmt", pct: "amtPct" },
    overdueChange: { base: "prevOverdue", collected: "runningOverdue", change: "overdueChange" }
  };

  function normKey(value) {
    return String(value === null || value === undefined ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, "");
  }

  /** "1,23,456.78" / "(1,234)" / "87.5%" -> number (or null when empty/invalid). */
  function toNum(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return isFinite(value) ? value : null;
    let str = String(value).trim();
    if (!str) return null;
    const negative = /^\((.*)\)$/.test(str);
    if (negative) str = str.replace(/^\((.*)\)$/, "$1");
    str = str.replace(/[,\s৳$%]/g, "");
    const n = parseFloat(str);
    if (isNaN(n)) return null;
    return negative ? -n : n;
  }

  /** Locate the row that holds the column headers (row with a "Plaza" heading cell). */
  function findHeaderRow(rows) {
    const limit = Math.min(rows.length, 40);
    for (let r = 0; r < limit; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = normKey(row[c]);
        if (cell === "plaza" || cell === "plazaname" || cell === "plazacode") {
          return { rowIndex: r, plazaCol: c };
        }
      }
    }
    return null;
  }

  /**
   * Map logical field names -> column index.
   *
   * Header text gives candidates, the actual data decides between them (a "Plaza Code"
   * column is empty next to a populated "Plaza" column). Falls back to the legacy
   * fixed indexes only when a field cannot be found at all.
   */
  function detectColumns(rows, headerRowIndex) {
    const headerRow = rows[headerRowIndex] || [];
    // collapse padding and the line breaks real reports use inside header cells
    const headers = headerRow.map(h => String(h === null || h === undefined ? "" : h)
      .toLowerCase().replace(/\s+/g, " ").trim());
    const sample = rows.slice(headerRowIndex + 1, headerRowIndex + 41);

    const stats = headers.map((header, index) => {
      let nonEmpty = 0;
      let numeric = 0;
      sample.forEach(row => {
        if (!row) return;
        const value = row[index];
        if (value === null || value === undefined || String(value).trim() === "") return;
        nonEmpty++;
        if (typeof value === "number" || toNum(value) !== null) numeric++;
      });
      return { index, header, nonEmpty, numeric };
    });

    const columns = {};
    const used = new Set();

    FIELDS.forEach(field => {
      const candidates = [];
      stats.forEach(stat => {
        if (!stat.header || used.has(stat.index)) return;
        if (field.not && field.not.test(stat.header)) return;
        let score = 0;
        field.any.forEach((re, i) => {
          if (re.test(stat.header)) score = Math.max(score, field.any.length - i);
        });
        if (!score) return;
        if (stat.header.length <= 42) score += 0.5;
        candidates.push({ stat, score });
      });
      if (!candidates.length) return;

      const wantsNumbers = NUMERIC_FIELDS.indexOf(field.key) !== -1;
      const quality = stat => {
        if (field.key === "plaza") return stat.nonEmpty >= 2 ? 2 : 0;
        if (wantsNumbers) return stat.numeric >= 3 ? 2 : (stat.numeric >= 1 ? 1 : 0);
        return stat.nonEmpty >= 1 ? 2 : 0;
      };

      candidates.sort((a, b) => {
        const qa = quality(a.stat);
        const qb = quality(b.stat);
        if (qa !== qb) return qb - qa;
        if (a.stat.nonEmpty !== b.stat.nonEmpty) return b.stat.nonEmpty - a.stat.nonEmpty;
        return b.score - a.score;
      });

      const best = candidates[0];
      if (quality(best.stat) === 0) return;
      columns[field.key] = best.stat.index;
      used.add(best.stat.index);
    });

    // Legacy fallback for anything still missing.
    Object.keys(LEGACY_INDEX).forEach(key => {
      if (columns[key] === undefined) columns[key] = LEGACY_INDEX[key];
    });

    return columns;
  }

  function isTotalRow(label) {
    const key = normKey(label);
    return /^(grand)?total$/.test(key) || key === "subtotal" || key === "all" || key === "সব";
  }

  /**
   * Parse the data rows of one sheet.
   * @returns {{entries: Array, columns: Object, headerRow: number, percentScale: number, skipped: number}}
   */
  function parseRows(rows, resolveDistrict) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("শীটে কোনো ডেটা নেই");

    const header = findHeaderRow(rows);
    if (!header) throw new Error('হেডার রো খুঁজে পাওয়া যায়নি — "Plaza" কলামটি আছে কিনা দেখুন');

    const columns = detectColumns(rows, header.rowIndex);
    const hasMetricColumn = ["qtyPct", "amtPct", "overdueChange", "collectedQty", "collectedAmt"]
      .some(key => columns[key] !== undefined);
    if (!hasMetricColumn) throw new Error("মেট্রিক কলাম খুঁজে পাওয়া যায়নি (Qty %, Amt %, Overdue)");

    const entries = [];
    let skipped = 0;

    for (let r = header.rowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) { continue; }
      const rawPlaza = columns.plaza !== undefined ? row[columns.plaza] : null;
      const plaza = String(rawPlaza === null || rawPlaza === undefined ? "" : rawPlaza).trim();
      if (!plaza || normKey(plaza) === "plaza" || isTotalRow(plaza)) { skipped++; continue; }

      const data = {};
      NUMERIC_FIELDS.forEach(key => { data[key] = columns[key] !== undefined ? toNum(row[columns[key]]) : null; });

      const districtRaw = columns.district !== undefined ? row[columns.district] : null;
      const districtFromFile = resolveDistrict ? resolveDistrict(districtRaw) : null;

      entries.push({
        plaza,
        plazaRaw: plaza,
        districtFromFile,
        area: columns.area !== undefined ? String(row[columns.area] === null || row[columns.area] === undefined ? "" : row[columns.area]).trim() : "",
        data
      });
    }

    if (!entries.length) throw new Error("ডেটা রো পাওয়া যায়নি — ফাইলটি খালি মনে হচ্ছে");

    const percentScale = detectPercentScale(entries);
    if (percentScale !== 1) {
      entries.forEach(entry => {
        if (entry.data.qtyPct !== null) entry.data.qtyPct = round2(entry.data.qtyPct * percentScale);
        if (entry.data.amtPct !== null) entry.data.amtPct = round2(entry.data.amtPct * percentScale);
      });
    }

    return { entries, columns, headerRow: header.rowIndex, percentScale, skipped };
  }

  /**
   * Some exports store the "#/%" columns as fractions (0.87 meaning 87%).
   * If every value is 0 or within (-1, 1], assume fractions and scale by 100.
   */
  function detectPercentScale(entries) {
    let maxAbs = 0;
    let seen = 0;
    entries.forEach(entry => {
      [entry.data.qtyPct, entry.data.amtPct].forEach(v => {
        if (v === null || v === undefined || isNaN(v)) return;
        seen++;
        maxAbs = Math.max(maxAbs, Math.abs(v));
      });
    });
    if (!seen || maxAbs === 0) return 1;
    return maxAbs <= 1.0000001 ? 100 : 1;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Build the plaza -> district index once so lookups are O(1).
   * @param {Array} mapping rows of {plaza, district, area, division}
   */
  function buildPlazaIndex(mapping, resolveDistrict) {
    const index = new Map();
    (mapping || []).forEach(row => {
      if (!row || !row.plaza) return;
      const shape = resolveDistrict ? resolveDistrict(row.district) : row.district;
      if (!shape) return;
      index.set(normKey(row.plaza), { shape, area: row.area || "", division: row.division || "" });
    });
    return index;
  }

  function lookupPlaza(index, plazaName) {
    const key = normKey(plazaName);
    if (index.has(key)) return index.get(key);

    // tolerate small naming differences: "Walton Plaza-X, City" vs "Walton Plaza-X"
    let best = null;
    index.forEach((value, indexKey) => {
      if (best) return;
      if (indexKey.length > 6 && (indexKey.includes(key) || key.includes(indexKey))) {
        best = value;
      }
    });
    return best;
  }

  /** Group parsed entries per district and compute the per-district aggregates. */
  function buildStats(entries, plazaIndex) {
    const stats = {};
    const unmatched = new Set();

    entries.forEach(entry => {
      let shape = entry.districtFromFile;
      let info = null;
      if (!shape) {
        info = lookupPlaza(plazaIndex, entry.plaza);
        shape = info ? info.shape : null;
      } else {
        info = lookupPlaza(plazaIndex, entry.plaza) || { area: "", division: "" };
      }
      entry.district = shape;
      entry.area = entry.area || (info ? info.area : "");
      entry.division = info ? info.division : "";
      if (!shape) { unmatched.add(entry.plaza); return; }

      const s = stats[shape] || (stats[shape] = {
        plazas: 0,
        list: [],
        qtyPct: [],
        amtPct: [],
        overdueChange: [],
        sum: {
          collectableQty: 0, collectedQty: 0,
          collectableAmt: 0, collectedAmt: 0,
          advance: 0, totalCollection: 0,
          prevOverdue: 0, runningOverdue: 0, overdueChange: 0
        }
      });
      s.plazas++;
      s.list.push(entry);
      if (entry.data.qtyPct !== null) s.qtyPct.push(entry.data.qtyPct);
      if (entry.data.amtPct !== null) s.amtPct.push(entry.data.amtPct);
      if (entry.data.overdueChange !== null) s.overdueChange.push(entry.data.overdueChange);
      Object.keys(s.sum).forEach(key => {
        if (entry.data[key] !== null && entry.data[key] !== undefined) s.sum[key] += entry.data[key];
      });
    });

    Object.keys(stats).forEach(shape => {
      const s = stats[shape];
      s.avgQtyPct = avg(s.qtyPct);
      s.avgAmtPct = avg(s.amtPct);
      s.sumOverdueChange = s.overdueChange.length ? s.sum.overdueChange : null;
      // district level "%": collected / collectable across the whole district
      // (falls back to the average of the per-plaza percentages when totals are missing)
      s.ratioQtyPct = ratio(s.sum.collectedQty, s.sum.collectableQty, s.avgQtyPct);
      s.ratioAmtPct = ratio(s.sum.collectedAmt, s.sum.collectableAmt, s.avgAmtPct);
      delete s.qtyPct;
      delete s.amtPct;
      delete s.overdueChange;
    });

    return { stats, unmatched: Array.from(unmatched) };
  }

  function ratio(collected, collectable, fallback) {
    if (collected > 0 && collectable > 0) return (collected / collectable) * 100;
    return fallback === undefined ? null : fallback;
  }

  function avg(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Value of the active metric for one district (null when there is no data).
   * Percentage metrics are collected/collectable across the district; the plain
   * average of the per-plaza percentages is kept separately (`avgQtyPct`/`avgAmtPct`).
   */
  function metricValue(stat, metric) {
    if (!stat) return null;
    if (metric === "collectedQty") return stat.ratioQtyPct;
    if (metric === "collectableAmt") return stat.ratioAmtPct;
    if (metric === "overdueChange") return stat.sumOverdueChange;
    return null;
  }

  /** Raw column values behind a metric for one district, ready for the UI. */
  function metricColumns(stat, metric) {
    const group = METRIC_GROUPS[metric];
    if (!group || !stat) return null;
    const out = {
      base: { key: group.base, value: stat.sum[group.base] },
      collected: { key: group.collected, value: stat.sum[group.collected] }
    };
    if (group.pct) {
      out.pct = { key: group.pct, value: metricValue(stat, metric) };
      out.pctAvg = stat[metric === "collectableAmt" ? "avgAmtPct" : "avgQtyPct"];
    } else {
      out.change = { key: group.change, value: metricValue(stat, metric) };
    }
    return out;
  }

  /** National aggregate across all districts/plazas for the active metric. */
  function nationalMetric(entries, metric) {
    if (metric === "overdueChange") {
      let total = 0;
      let seen = false;
      entries.forEach(e => {
        if (e.data.overdueChange !== null) { total += e.data.overdueChange; seen = true; }
      });
      return seen ? total : null;
    }
    const group = METRIC_GROUPS[metric];
    let collected = 0;
    let base = 0;
    let seen = false;
    entries.forEach(e => {
      const c = e.data[group.collected];
      const b = e.data[group.base];
      if (c !== null && b !== null && c !== undefined && b !== undefined) {
        collected += c;
        base += b;
        seen = true;
      }
    });
    if (seen && base > 0) return (collected / base) * 100;
    const values = [];
    entries.forEach(e => { if (e.data[group.pct] !== null) values.push(e.data[group.pct]); });
    return avg(values);
  }

  return {
    LEGACY_INDEX,
    METRIC_GROUPS,
    parseRows,
    detectColumns,
    detectPercentScale,
    buildPlazaIndex,
    buildStats,
    metricValue,
    metricColumns,
    nationalMetric,
    toNum,
    normKey
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = PlazaParser;
}
