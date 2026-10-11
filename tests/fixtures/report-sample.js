/**
 * Real report sample (rows exactly as in "Target Hire Accounts Summary Report", October 2026).
 *
 * Notable properties of the real layout that the parser must cope with:
 *  - four title rows above the header (and a blank row)
 *  - spacer columns between the logical columns
 *  - one header cell containing line breaks ("Total Collection\n\n(Collected + Advance)")
 *  - padded header text ("Collectable      Amt.", "Collectable Vs. Collected Amt (%)  ")
 *  - numbers arriving as formatted strings ("4,791,958")
 *
 * Column layout (0-based): 4 Division, 5 Area, 7 Plaza, 9 Collectable Acc. Qty.,
 * 10 Collected Acc. Qty., 11 Collectable Vs. Collected Acc Qty (%), 13 Collectable Amt.,
 * 16 Collected Amt., 18 Collection Advance, 19 Total Collection, 20 Collectable Vs. Collected Amt (%),
 * 21 Previous Month Overdue, 23 Running Month Overdue, 25 Overdue Increase/(Decrease)
 */
const REPORT_TITLE_ROWS = [
  ["Walton Plaza"],
  ["Target Hire Accounts Summary Report"],
  ["October 2026"],
  []
];

const REPORT_HEADER = [
  "", "S / N", "", "", "Division", "Area", "", "Plaza", "",
  "Collectable Acc. Qty.", "Collected Acc. Qty.", "Collectable Vs. Collected Acc Qty (%)", "",
  "Collectable      Amt.", "", "", "Collected       Amt.", "", "Collection Advance",
  "Total Collection\n\n(Collected + Advance)", "Collectable Vs. Collected Amt (%)  ",
  "Previous Month Overdue", "", "Running Month Overdue", "", "Overdue Increase/(Decrease)"
];

/** [S/N, Division, Area, Plaza, CollectableQty, CollectedQty, Qty%, CollectableAmt, CollectedAmt, Advance, TotalCollection, Amt%, PrevOverdue, RunningOverdue, OverdueChange] */
const REPORT_ROWS = [
  [1, "Division-01", "Dhaka Central Area", "Walton Plaza-Ati Bazar", "627", "116", "18.50", "4,791,958", "259,682", "288,923", "548,605", "5.42", "8,851,155", "9,058,803", "207,648"],
  [2, "Division-01", "Dhaka Central Area", "Walton Plaza-Azimpur", "574", "77", "13.41", "3,747,600", "169,702", "169,300", "339,002", "4.53", "4,439,544", "4,927,338", "487,794"],
  [3, "Division-01", "Dhaka Central Area", "Walton Plaza-Banglamotor", "503", "90", "17.89", "2,006,376", "187,637", "275,367", "463,004", "9.35", "1,675,072", "1,981,807", "306,735"],
  [4, "Division-01", "Dhaka Central Area", "Walton Plaza-Bangshal", "393", "99", "25.19", "1,372,018", "210,441", "272,272", "482,713", "15.34", "1,463,246", "1,577,273", "114,027"],
  [5, "Division-01", "Dhaka Central Area", "Walton Plaza-Bosila, Mohammadpur", "361", "96", "26.59", "924,504", "225,934", "215,275", "441,209", "24.44", "55,190", "152,785", "97,595"]
];

/** Rows as the parser receives them from SheetJS (header: 1). */
function reportRows() {
  const rows = REPORT_TITLE_ROWS.map(row => row.slice());
  rows.push(REPORT_HEADER.slice());
  REPORT_ROWS.forEach(row => {
    const cells = new Array(26).fill("");
    cells[1] = row[0];
    cells[4] = row[1];
    cells[5] = row[2];
    cells[7] = row[3];
    cells[9] = row[4];
    cells[10] = row[5];
    cells[11] = row[6];
    cells[13] = row[7];
    cells[16] = row[8];
    cells[18] = row[9];
    cells[19] = row[10];
    cells[20] = row[11];
    cells[21] = row[12];
    cells[23] = row[13];
    cells[25] = row[14];
    rows.push(cells);
  });
  rows.push(["", "Total"]);
  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { REPORT_TITLE_ROWS, REPORT_HEADER, REPORT_ROWS, reportRows };
}
