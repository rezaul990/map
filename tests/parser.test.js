/* Parser unit tests — run with: node tests/parser.test.js */
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const P = require(path.join(root, 'js/parse.js'));
const D = require(path.join(root, 'js/data.js'));
const mapping = require(path.join(root, 'data/plaza-district.json'));
const idx = P.buildPlazaIndex(mapping, D.bdResolveDistrict);

function makeRows() {
  const header = new Array(26).fill('');
  header[0]='S/N'; header[1]='Division'; header[2]='Area'; header[3]='Plaza Code'; header[7]='Plaza';
  header[9]='Collectable Acc Qty'; header[10]='Collected Acc Qty'; header[11]='Collectable Vs. Collected Acc Qty (%)';
  header[13]='Collectable Amt.'; header[16]='Collected Acc Amt.'; header[18]='Advance'; header[19]='Total Collection';
  header[20]='Collectable Vs. Collected Amt. (%)'; header[21]='Prev. Overdue'; header[23]='Running Overdue';
  header[25]='Overdue Increase/(Decrease)';
  const rows = [['cover line'], ['Report: hireTargetAccAll'], header];
  const add = (plaza, qtyPct, amtPct, od) => {
    const r = new Array(26).fill('');
    r[1]='Division-01'; r[2]='Dhaka Central Area'; r[7]=plaza;
    r[9]=1000; r[10]=900; r[11]=qtyPct; r[13]=500000; r[16]=400000; r[18]=1000; r[19]=2500;
    r[20]=amtPct; r[21]=10000; r[23]=10000+od; r[25]=od;
    rows.push(r);
  };
  add('Walton Plaza-Ati Bazar', 92.4, 88.1, -500);
  add('Walton Plaza-Azimpur', 61.2, 55.0, 1200);
  add('Walton Plaza-Banglamotor', 75.5, 71.0, 0);
  add('Unknown Plaza XYZ', 50, 50, 10);
  rows.push(['','Total','','','','','','','','','','','','','','','','','','','','','','','','']);
  return rows;
}

let pass = 0;
function ok(name, fn) { try { fn(); pass++; } catch (e) { console.error('FAIL:', name, e.message); process.exitCode = 1; } }

ok('header row detected past cover rows', () => {
  const out = P.parseRows(makeRows(), D.bdResolveDistrict);
  assert.strictEqual(out.headerRow, 2);
  assert.strictEqual(out.columns.plaza, 7, 'plaza col');
  assert.strictEqual(out.columns.qtyPct, 11);
  assert.strictEqual(out.columns.amtPct, 20);
  assert.strictEqual(out.columns.overdueChange, 25);
  assert.strictEqual(out.columns.collectableQty, 9);
  assert.strictEqual(out.columns.collectedAmt, 16);
  assert.strictEqual(out.entries.length, 4);
});

ok('district resolution + stats', () => {
  const out = P.parseRows(makeRows(), D.bdResolveDistrict);
  const { stats, unmatched } = P.buildStats(out.entries, idx);
  assert.deepStrictEqual(unmatched, ['Unknown Plaza XYZ']);
  assert.strictEqual(stats['Dhaka'].plazas, 3);
  assert.ok(Math.abs(stats['Dhaka'].avgQtyPct - (92.4+61.2+75.5)/3) < 1e-9);
  assert.strictEqual(stats['Dhaka'].sumOverdueChange, 700);
  assert.strictEqual(P.nationalMetric(out.entries, 'overdueChange'), 710);
});

ok('fraction percentages auto-scale to %', () => {
  const rows = makeRows();
  for (let r = 3; r < rows.length - 1; r++) { rows[r][11] = rows[r][11]/100; rows[r][20] = rows[r][20]/100; }
  const out = P.parseRows(rows, D.bdResolveDistrict);
  assert.strictEqual(out.percentScale, 100);
  assert.ok(Math.abs(out.entries[0].data.qtyPct - 92.4) < 1e-9);
});

ok('extra columns inserted at the front still detected', () => {
  const rows = makeRows().map(row => row ? ['x', ...row] : row);
  const out = P.parseRows(rows, D.bdResolveDistrict);
  assert.strictEqual(out.columns.plaza, 8);
  assert.strictEqual(out.columns.qtyPct, 12);
  assert.strictEqual(out.columns.amtPct, 21);
  assert.strictEqual(out.columns.overdueChange, 26);
  assert.strictEqual(out.entries.length, 4);
});

ok('renamed columns are still detected', () => {
  const rows = makeRows();
  rows[2][11] = 'Recovery %';
  rows[2][25] = 'Overdue Change';
  const out = P.parseRows(rows, D.bdResolveDistrict);
  assert.strictEqual(out.columns.qtyPct, 11);
  assert.strictEqual(out.columns.overdueChange, 25);
});

ok('district column in file wins over mapping', () => {
  const rows = makeRows();
  const header = rows[2];
  header[4] = 'District Name';
  for (let r = 3; r < rows.length - 1; r++) rows[r][4] = 'Cumilla';
  const out = P.parseRows(rows, D.bdResolveDistrict);
  const { stats, unmatched } = P.buildStats(out.entries, idx);
  assert.strictEqual(stats['Comilla'].plazas, 4);
  assert.strictEqual(unmatched.length, 0);
  assert.strictEqual(out.columns.district, 4);
});

ok('number coercion', () => {
  assert.strictEqual(P.toNum('1,23,456.78'), 123456.78);
  assert.strictEqual(P.toNum('(1,500)'), -1500);
  assert.strictEqual(P.toNum('87.5%'), 87.5);
  assert.strictEqual(P.toNum(''), null);
  assert.strictEqual(P.toNum('n/a'), null);
});

ok('district alias lookup', () => {
  assert.strictEqual(D.bdResolveDistrict('Bogura'), 'Bogra');
  assert.strictEqual(D.bdResolveDistrict(' Chapai Nawabganj '), 'Nawabganj');
  assert.strictEqual(D.bdResolveDistrict("Coxs Bazar"), "Cox's Bazar");
  assert.strictEqual(D.bdResolveDistrict('Narail District'), 'Narail');
  assert.strictEqual(D.bdResolveDistrict('Atlantis'), null);
});

/* ------------------------------------------------------------------
 * Real report sample — "Target Hire Accounts Summary Report"
 * ------------------------------------------------------------------ */
const { reportRows, REPORT_ROWS } = require('./fixtures/report-sample.js');

ok('real report: columns are detected despite spacer columns and padded headers', () => {
  const out = P.parseRows(reportRows(), D.bdResolveDistrict);
  assert.strictEqual(out.headerRow, 4, 'header sits below four title rows');
  assert.deepStrictEqual(out.columns, {
    plaza: 7, area: 5,
    collectableQty: 9, collectedQty: 10, qtyPct: 11,
    collectableAmt: 13, collectedAmt: 16, amtPct: 20,
    advance: 18, totalCollection: 19,
    prevOverdue: 21, runningOverdue: 23, overdueChange: 25
  });
  assert.strictEqual(out.entries.length, 5);
  assert.strictEqual(out.skipped, 1, 'the Total row is skipped');
});

ok('real report: every value is parsed (regression: amtPct was dropped)', () => {
  const out = P.parseRows(reportRows(), D.bdResolveDistrict);
  const first = out.entries[0];
  assert.strictEqual(first.plaza, 'Walton Plaza-Ati Bazar');
  assert.strictEqual(first.data.collectableQty, 627);
  assert.strictEqual(first.data.collectedQty, 116);
  assert.strictEqual(first.data.qtyPct, 18.5);
  assert.strictEqual(first.data.collectableAmt, 4791958);
  assert.strictEqual(first.data.collectedAmt, 259682);
  assert.strictEqual(first.data.amtPct, 5.42);
  assert.strictEqual(first.data.advance, 288923);
  assert.strictEqual(first.data.totalCollection, 548605);
  assert.strictEqual(first.data.prevOverdue, 8851155);
  assert.strictEqual(first.data.runningOverdue, 9058803);
  assert.strictEqual(first.data.overdueChange, 207648);
});

ok('real report: district aggregation uses the raw column totals', () => {
  const out = P.parseRows(reportRows(), D.bdResolveDistrict);
  const { stats, unmatched } = P.buildStats(out.entries, idx);
  const dhaka = stats['Dhaka'];
  assert.deepStrictEqual(unmatched, []);
  assert.strictEqual(dhaka.plazas, 5);

  const qty = REPORT_ROWS.reduce((a, r) => a + Number(r[4].replace(/,/g, '')), 0);
  const collectedQty = REPORT_ROWS.reduce((a, r) => a + Number(r[5]), 0);
  const amt = REPORT_ROWS.reduce((a, r) => a + Number(r[7].replace(/,/g, '')), 0);
  const collectedAmt = REPORT_ROWS.reduce((a, r) => a + Number(r[8].replace(/,/g, '')), 0);
  const overdueChange = REPORT_ROWS.reduce((a, r) => a + Number(r[14].replace(/,/g, '')), 0);

  assert.strictEqual(dhaka.sum.collectableQty, qty);
  assert.strictEqual(dhaka.sum.collectedQty, collectedQty);
  assert.strictEqual(dhaka.sum.collectableAmt, amt);
  assert.strictEqual(dhaka.sum.collectedAmt, collectedAmt);
  assert.strictEqual(dhaka.sumOverdueChange, overdueChange);
  assert.strictEqual(Number(dhaka.ratioQtyPct.toFixed(2)), Number((collectedQty / qty * 100).toFixed(2)));
  assert.strictEqual(Number(dhaka.ratioAmtPct.toFixed(2)), Number((collectedAmt / amt * 100).toFixed(2)));
  assert.notStrictEqual(Math.round(dhaka.avgAmtPct), Math.round(dhaka.ratioAmtPct), 'average % and aggregate % differ');
});

ok('real report: metric columns expose the exact report triplets', () => {
  const out = P.parseRows(reportRows(), D.bdResolveDistrict);
  const { stats } = P.buildStats(out.entries, idx);
  const dhaka = stats['Dhaka'];
  assert.deepStrictEqual(
    [P.metricColumns(dhaka, 'collectedQty').base.key, P.metricColumns(dhaka, 'collectedQty').collected.key, P.metricColumns(dhaka, 'collectedQty').pct.key],
    ['collectableQty', 'collectedQty', 'qtyPct']);
  assert.deepStrictEqual(
    [P.metricColumns(dhaka, 'collectableAmt').base.key, P.metricColumns(dhaka, 'collectableAmt').collected.key, P.metricColumns(dhaka, 'collectableAmt').pct.key],
    ['collectableAmt', 'collectedAmt', 'amtPct']);
  assert.deepStrictEqual(
    [P.metricColumns(dhaka, 'overdueChange').base.key, P.metricColumns(dhaka, 'overdueChange').collected.key, P.metricColumns(dhaka, 'overdueChange').change.key],
    ['prevOverdue', 'runningOverdue', 'overdueChange']);
});

ok('real report: low percentages still spread across the legend bands', () => {
  // the sample values are 5.42% - 24.44%, so fixed 60/70/80 thresholds would paint everything red
  const out = P.parseRows(reportRows(), D.bdResolveDistrict);
  assert.ok(out.entries.every(e => e.data.amtPct !== null && e.data.amtPct < 30));
  const values = out.entries.map(e => e.data.amtPct).sort((a, b) => a - b);
  assert.strictEqual(values[0], 4.53);
  assert.strictEqual(values[values.length - 1], 24.44);
});

console.log(pass, 'parser test groups passed');
