// Writes the results of a checked conformance test report (conformance.js) as a file to send back to the client:
// an Excel workbook (ExcelJS) or a PDF (jsPDF with its table plug-in). Both files use the same layout, defined once
// below: a summary, then one row per test step.

import { loadScript } from "./attachments.js?v=25";
import { RESULTS, fmtClock, fmtDate } from "./conformance.js?v=25";

const EXCELJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const AUTOTABLE_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";

export const MESSAGES_CHECKED = "JSE Trading FIX message data, 01/07/2026 to 30/09/2026";

// What each result means, printed under the summary of every report.
export const RESULT_MEANINGS = [
  [RESULTS.PASS, "The messages show the test step was done as Volume 202 requires."],
  [RESULTS.FAIL, "The messages show the test step was not done as required, or the report's details do not match the messages. The reason says what is wrong."],
  [RESULTS.REVIEW, "The messages do not settle the result, for example because some messages are not in the export or the report's test time is wrong. A JSE analyst decides."],
  [RESULTS.NOT_CHECKABLE, "The step uses a gateway or service whose messages are not in the exports (market data, Post Trade, Drop Copy, FIX, derivatives)."],
  [RESULTS.NOT_ATTEMPTED, "The client gave no response for this step."],
];

// The columns of the "Test results" table: heading, width in Excel characters, and the value for one test step.
export const RESULT_COLUMNS = [
  ["Ref", 7, (r) => r.ref],
  ["Test case ID", 11, (r) => r.id],
  ["Test", 42, (r) => r.title],
  ["Mandatory", 10, (r) => r.mandatory],
  ["CompID", 9, (r) => r.compid],
  ["Test time in report", 18, (r) => r.time],
  ["Time of the messages", 18, (r) => (r.messageTime ? `${fmtDate(r.messageTime)} ${fmtClock(r.messageTime)}` : "")],
  ["Result", 13, (r) => r.result],
  ["Reason", 55, (r) => r.reason],
  ["What the messages show", 70, (r) => r.shows],
  ["IDs found", 26, (r) => (r.idsFound || []).join("\n")],
  ["IDs not found", 22, (r) => (r.idsMissing || []).join("\n")],
  ["Client comment", 28, (r) => r.clientComment],
  ["JSE comment in report", 24, (r) => r.jseComment],
];

const RESULT_COLOURS = { [RESULTS.PASS]: "D1FADF", [RESULTS.FAIL]: "FEE4E2", [RESULTS.REVIEW]: "FEF0C7", [RESULTS.NOT_CHECKABLE]: "EAECF0", [RESULTS.NOT_ATTEMPTED]: "F2F4F7" };

// The analyst can ask for a result to be changed: changes is [{ test, result, reason }], where test is a test ID
// (T3-006) or reference (T3.6). The change is applied to the copy written to the file, and the reason says so.
function applyChanges(checked, changes = []) {
  const results = checked.results.map((r) => ({ ...r }));
  const applied = [];
  for (const c of changes || []) {
    const want = String(c.test || "").trim().toUpperCase();
    const result = Object.values(RESULTS).find((v) => v.toLowerCase() === String(c.result || "").trim().toLowerCase());
    if (!result) continue;
    for (const r of results) {
      if (r.id.toUpperCase() !== want && r.ref.toUpperCase() !== want) continue;
      r.reason = `Changed by the JSE analyst from ${r.result} to ${result}${c.reason ? `: ${c.reason}` : ""}. Automatic check: ${r.reason}`;
      r.result = result;
      applied.push(`${r.id} ${result}`);
    }
  }
  const counts = Object.fromEntries(Object.values(RESULTS).map((v) => [v, results.filter((r) => r.result === v).length]));
  const overall = counts[RESULTS.FAIL] ? "Not passed" : counts[RESULTS.REVIEW] ? "Needs analyst review"
    : counts[RESULTS.PASS] ? "Passed, for the tests the exported messages can check" : "Nothing to check";
  return { ...checked, results, counts, overall, applied };
}

function summaryRows(c, summary) {
  return [
    ["Client CompID", c.compids.join(", ")],
    ["Client report checked", c.file],
    ["Checked on", fmtDate(c.checkedAt)],
    ["Messages checked", MESSAGES_CHECKED],
    ["Overall result", c.overall],
    ...Object.entries(c.counts).map(([k, v]) => [`Test steps: ${k}`, v]),
    ["Mandatory steps with no response", c.mandatoryMissing.map((r) => r.id).join(", ") || "None"],
    ["JSE comments", summary || ""],
  ];
}

const fileStem = (c) => `Conformance results - ${c.compids.join(" ") || "client"} - ${fmtDate(c.checkedAt).replace(/\//g, "-")}`;

// Builds the workbook. ExcelJS is passed in, so the same layout can be written outside the browser. The layout is
// described in knowledge/client_report_template.md; change that file when the layout changes.
export function buildWorkbook(ExcelJS, c, summary = "") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Trading Conformance Agent";
  const header = (ws) => {
    const row = ws.getRow(ws.rowCount);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B5CAD" } };
    row.alignment = { vertical: "middle", wrapText: true };
  };

  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 34 }, { width: 110 }];
  s.addRow(["Conformance test results"]).font = { bold: true, size: 15 };
  s.addRow([]);
  for (const [k, v] of summaryRows(c, summary)) {
    const row = s.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: "top", wrapText: true };
    if (k === "Overall result") row.getCell(2).font = { bold: true };
  }
  s.addRow([]);
  s.addRow(["Result", "What it means"]);
  header(s);
  for (const [k, v] of RESULT_MEANINGS) {
    const row = s.addRow([k, v]);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${RESULT_COLOURS[k]}` } };
  }

  const t = wb.addWorksheet("Test results", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  t.columns = RESULT_COLUMNS.map(([h, w]) => ({ header: h, width: w }));
  header(t);
  for (const r of c.results) {
    const row = t.addRow(RESULT_COLUMNS.map(([, , get]) => get(r) ?? ""));
    row.alignment = { vertical: "top", wrapText: true };
    const cell = row.getCell(RESULT_COLUMNS.findIndex(([h]) => h === "Result") + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${RESULT_COLOURS[r.result] || "FFFFFF"}` } };
    cell.font = { bold: true };
  }
  t.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: RESULT_COLUMNS.length } };

  return wb;
}

// The PDF's standard fonts hold only Western European characters.
const pdfText = (v) => String(v ?? "").replace(/…/g, "...").replace(/×/g, "x").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");

function buildPdf(c, summary) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(15);
  doc.text("Conformance test results", 12, 14);
  doc.autoTable({
    startY: 19, theme: "plain", styles: { fontSize: 8.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 } },
    body: summaryRows(c, summary).map(([k, v]) => [k, pdfText(v)]),
  });
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 4, styles: { fontSize: 7.5, cellPadding: 1.2 }, headStyles: { fillColor: [11, 92, 173] },
    head: [["Result", "What it means"]], body: RESULT_MEANINGS, columnStyles: { 0: { cellWidth: 30 } },
    didParseCell: (d) => { if (d.section === "body" && d.column.index === 0) d.cell.styles.fillColor = `#${RESULT_COLOURS[d.cell.raw]}`; },
  });
  doc.addPage();
  const cols = [["Ref", 11], ["Test case ID", 17], ["Test", 55], ["Mand.", 11], ["CompID", 15], ["Test time in report", 24], ["Result", 20], ["Reason and what the messages show", 120]];
  doc.autoTable({
    styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak", valign: "top" }, headStyles: { fillColor: [11, 92, 173] },
    head: [cols.map(([h]) => h)], columnStyles: Object.fromEntries(cols.map(([, w], i) => [i, { cellWidth: w }])),
    body: c.results.map((r) => [r.ref, r.id, r.title, r.mandatory, r.compid, r.time, r.result,
      [r.reason, r.shows].filter(Boolean).join("\n")].map(pdfText)),
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 6) { d.cell.styles.fillColor = `#${RESULT_COLOURS[d.cell.raw] || "FFFFFF"}`; d.cell.styles.fontStyle = "bold"; }
    },
  });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.text(`${pdfText(c.file)} - checked ${fmtDate(c.checkedAt)} - page ${p} of ${pages}`, 12, 203);
  }
  return doc.output("blob");
}

// format: "excel", "pdf" or "both". Returns [{ name, blob }].
export async function makeClientReport(checked, { format = "excel", summary = "", changes = [] } = {}) {
  const c = applyChanges(checked, changes);
  const files = [];
  if (format === "excel" || format === "both") {
    const ExcelJS = await loadScript(EXCELJS_URL, "ExcelJS");
    const buffer = await buildWorkbook(ExcelJS, c, summary).xlsx.writeBuffer();
    files.push({ name: `${fileStem(c)}.xlsx`, blob: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) });
  }
  if (format === "pdf" || format === "both") {
    await loadScript(JSPDF_URL, "jspdf");
    await loadScript(AUTOTABLE_URL, "jspdf");
    files.push({ name: `${fileStem(c)}.pdf`, blob: buildPdf(c, summary) });
  }
  return { files, applied: c.applied, overall: c.overall, counts: c.counts };
}
