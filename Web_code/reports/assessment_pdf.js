// Writes the PDF report to the client in the layout of Updates/WKP_Trading_Conformance_Client_Report_Card_Format.pdf,
// with jsPDF and its table plug-in (both downloaded by client_report.js before buildAssessmentPdf is called).
// Page 1: the overall result, the counts, the decision with a ring chart of the share of tests passed, and the
// controls the assessment applies. Then one section per result (Passed, Failed, Needs review), each starting on a new
// page, with one table per test: the request and response the test needs, the criteria the rule applies, what the
// messages show, and the conclusion. The last section ends with the approval condition.
// Only trading tests the Trading FIX message data can check are assessed. Of the tests with no client response, the
// required ones are counted and listed as Not attempted, so the counts add up to the number of tests; the others are
// left out.

import { RESULTS, criteriaFor, isRequired, notCheckable } from "./conformance.js?v=27";

const C = {
  green: "#78BE20", darkBlue: "#163A5F", teal: "#00787A", red: "#D64541", grey: "#5A6770", orange: "#F5A623",
  amber: "#C27C0E", text: "#2B2B2B", panel: "#F2F4F4", panelLine: "#D5DBDB", rowAlt: "#F5F7F7",
  passLight: "#EAF5DC", failLight: "#FBE6E5", reviewLight: "#FDF1DC", noteFill: "#FFF6DD", missing: "#3D4A54",
  missingLight: "#E8ECEF",
};
const PAGE_W = 210, PAGE_H = 297, M = 10, INNER = PAGE_W - 2 * M;
const FOOTER = "JSE Trading Conformance | Client Assessment";
const REFERENCE = "JSE Volume 01E - Basic Native Trading Gateway v4.05, Volume 202 - Conformance Test Report v3.08";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (d) => `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// The PDF's standard fonts hold only Western European characters.
const pdfText = (v) => String(v ?? "").replace(/…/g, "...").replace(/×/g, "x").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const percent = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : "0%");

// The counts and lists every part of the PDF uses.
function assess(c) {
  const inScope = (r) => r.result !== RESULTS.NOT_CHECKABLE && !notCheckable(r.id);
  const assessed = c.results.filter((r) => inScope(r) && r.result !== RESULTS.NOT_ATTEMPTED);
  const requiredTests = c.results.filter((r) => inScope(r) && isRequired(r));
  // Every required test with no response, including those the client marked N/A, so that
  // passed + failed + needs review + not attempted = the number of tests.
  const missing = requiredTests.filter((r) => r.result === RESULTS.NOT_ATTEMPTED);
  const by = (result) => assessed.filter((r) => r.result === result);
  const outside = c.results.filter((r) => r.result === RESULTS.NOT_CHECKABLE).map((r) => r.id);
  const times = assessed.map((r) => r.messageTime).filter(Boolean).sort((a, b) => a - b);
  return {
    assessed, missing, outside, times,
    passed: by(RESULTS.PASS), failed: by(RESULTS.FAIL), review: by(RESULTS.REVIEW),
    required: requiredTests.length,
    evidence: requiredTests.filter((r) => r.result !== RESULTS.NOT_ATTEMPTED).length,
    total: assessed.length + missing.length,
  };
}

// Text shrunk until it fits the width given.
function fitText(doc, text, size, width) {
  doc.setFontSize(size);
  while (size > 4 && doc.getTextWidth(text) > width) doc.setFontSize(size -= 0.25);
  return size;
}

// A ring segment from angle a0 to a1 (radians, clockwise from the top), drawn as a filled outline.
function ringSegment(doc, cx, cy, outer, inner, a0, a1, colour) {
  if (a1 - a0 <= 0.0001) return;
  const steps = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 90)));
  const at = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(at(outer, a0 + ((a1 - a0) * i) / steps));
  for (let i = steps; i >= 0; i--) points.push(at(inner, a0 + ((a1 - a0) * i) / steps));
  const deltas = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
  doc.setFillColor(colour);
  doc.lines(deltas, points[0][0], points[0][1], [1, 1], "F", true);
}

// A bold label followed by normal text wrapped to the width left after the label. Returns the lines of the text.
function labelled(doc, label, text, x, y, width) {
  doc.setFont("helvetica", "bold");
  const indent = doc.getTextWidth(label) + 1.5;
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(pdfText(text), width - indent);
  doc.text(lines, x + indent, y);
  return lines.length;
}

function pageTitle(doc, title, subtitle) {
  doc.setFont("helvetica", "bold");
  doc.setTextColor(C.darkBlue);
  fitText(doc, title, 21, INNER);
  doc.text(title, M, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(C.grey);
  doc.text(pdfText(subtitle), M, 26);
}

function firstPage(doc, c, a, summary) {
  const date = a.times.length ? a.times[a.times.length - 1] : c.checkedAt;
  pageTitle(doc, "TRADING CONFORMANCE ASSESSMENT",
    `${c.compids.join(", ") || "Client"} | Client conformance result | Trading only | ${longDate(date)}`);

  // The overall result.
  const needAction = a.failed.length + a.missing.length;
  const [banner, colour] = !a.total ? ["NO TRADING TESTS TO ASSESS", C.grey]
    : needAction ? [`FAIL - ${needAction} OF ${a.total} TESTS NEED ACTION`, C.red]
    : a.review.length ? [`REVIEW - ${a.review.length} OF ${a.total} TESTS AWAIT A JSE DECISION`, C.orange]
    : [`PASS - ALL ${a.total} TESTS PASSED`, C.green];
  const y0 = 30, h0 = 13, left = 34;
  doc.setFillColor(C.darkBlue);
  doc.rect(M, y0, left, h0, "F");
  doc.setFillColor(colour);
  doc.rect(M + left, y0, INNER - left, h0, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("OVERALL RESULT", M + left / 2, y0 + h0 / 2 + 1.2, { align: "center" });
  fitText(doc, banner, 16, INNER - left - 8);
  doc.text(banner, M + left + (INNER - left) / 2, y0 + h0 / 2 + 2, { align: "center" });

  // The counts.
  const tiles = [
    [a.required, "REQUIRED TESTS", C.darkBlue], [a.evidence, "EVIDENCE PROVIDED", C.teal],
    [a.passed.length, "PASSED", C.green], [a.failed.length, "FAILED", C.red],
    ...(a.review.length ? [[a.review.length, "NEEDS REVIEW", C.amber]] : []),
    ...(a.missing.length ? [[a.missing.length, "NOT ATTEMPTED", C.missing]] : []),
    [percent(a.passed.length, a.total), "PASS RATE", C.grey], [percent(needAction, a.total), "RETEST / FIX", C.orange],
  ];
  const gap = 1.2, tw = (INNER - gap * (tiles.length - 1)) / tiles.length, ty = 46, th = 15;
  tiles.forEach(([value, label, fill], i) => {
    const x = M + i * (tw + gap);
    doc.setFillColor(fill);
    doc.rect(x, ty, tw, th, "F");
    doc.setTextColor("#FFFFFF");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(String(value), x + tw / 2, ty + 7.3, { align: "center" });
    doc.setFont("helvetica", "normal");
    fitText(doc, label, 6.3, tw - 2);
    doc.text(label, x + tw / 2, ty + 12.5, { align: "center" });
  });

  // The decision, with a ring chart of the share of tests passed.
  const sentences = [];
  if (a.total) {
    sentences.push(`${plural(a.assessed.length, "trading test")} with client evidence ${a.assessed.length === 1 ? "was" : "were"} assessed: ${a.passed.length} passed, ${a.failed.length} failed` +
      `${a.review.length ? `, ${a.review.length} need${a.review.length === 1 ? "s" : ""} a decision by a JSE analyst` : ""}.`);
  } else {
    sentences.push("The report holds no trading test that the Trading FIX message data can check.");
  }
  if (a.required) sentences.push(`${a.evidence} of ${plural(a.required, "required test")} contained client evidence.`);
  if (a.missing.length) sentences.push(`${plural(a.missing.length, "required test")} ${a.missing.length === 1 ? "was" : "were"} not attempted: ${a.missing.map((r) => r.id).join(", ")}.`);
  if (needAction) {
    const parts = [a.failed.length ? `all ${plural(a.failed.length, "failed test")} ${a.failed.length === 1 ? "is" : "are"} corrected and successfully repeated` : "",
                   a.missing.length ? `evidence is supplied for ${plural(a.missing.length, "required test")}` : ""].filter(Boolean);
    sentences.push(`The submission is not approved until ${parts.join(" and ")}.`);
  } else if (a.review.length) {
    sentences.push(`The submission is not approved until a JSE analyst decides the ${plural(a.review.length, "test")} that need review.`);
  } else if (a.total) {
    sentences.push("Every assessed test passed.");
  }
  const scope = a.outside.length
    ? `Trading only. Tests whose messages are not in the Trading FIX message data (${a.outside.join(", ")}), and agreed exemptions, are outside this assessment.`
    : "Trading only. Market data, Post Trade, Drop Copy and derivatives tests, and agreed exemptions, are outside this assessment.";

  const textW = 122, by = 64;
  doc.setFontSize(8.5);
  const body = doc.splitTextToSize(pdfText(sentences.join(" ")), textW);
  // The line counts of the labelled parts, measured as labelled() will wrap them.
  doc.setFont("helvetica", "bold");
  const scopeIndent = doc.getTextWidth("Scope:") + 1.5, commentIndent = doc.getTextWidth("JSE comments:") + 1.5;
  doc.setFont("helvetica", "normal");
  const scopeCount = doc.splitTextToSize(pdfText(scope), textW - scopeIndent).length;
  const commentCount = summary ? doc.splitTextToSize(pdfText(summary), textW - commentIndent).length : 0;
  const line = 3.7;
  const textH = 7 + (body.length + scopeCount + commentCount) * line + (commentCount ? 4 : 0) + 4;
  const bh = Math.max(50, textH + 12);
  doc.setFillColor(C.panel);
  doc.setDrawColor(C.panelLine);
  doc.setLineWidth(0.2);
  doc.rect(M, by, INNER, bh, "FD");

  let y = by + Math.max(9, (bh - textH) / 2 + 4);
  doc.setTextColor(C.darkBlue);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Executive decision", M + 5, y);
  y += 5;
  doc.setTextColor(C.text);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(body, M + 5, y);
  y += body.length * line + 2;
  y += labelled(doc, "Scope:", scope, M + 5, y, textW) * line + 2;
  if (summary) labelled(doc, "JSE comments:", summary, M + 5, y, textW);

  const cx = M + INNER - 30, cy = by + bh / 2, outer = 21, inner = 13.5;
  const share = (n) => (a.total ? (2 * Math.PI * n) / a.total : 0);
  let angle = 0;
  if (!a.total) ringSegment(doc, cx, cy, outer, inner, 0, 2 * Math.PI - 0.0002, C.panelLine);
  for (const [n, fill] of [[a.passed.length, C.green], [a.review.length, C.orange], [a.failed.length, C.red], [a.missing.length, C.missing]]) {
    ringSegment(doc, cx, cy, outer, inner, angle, Math.min(angle + share(n), 2 * Math.PI - 0.0002), fill);
    angle += share(n);
  }
  doc.setTextColor(C.darkBlue);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(percent(a.passed.length, a.total), cx, cy + 1.5, { align: "center" });
  doc.setTextColor(C.grey);
  doc.setFontSize(6);
  doc.text("PASSED", cx, cy + 5.5, { align: "center" });

  // The controls the assessment applies.
  const ty2 = by + bh + 9;
  doc.setTextColor(C.darkBlue);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Assessment and specification controls", M + 2, ty2);
  doc.autoTable({
    startY: ty2 + 1.5, margin: { left: M, right: M, top: 12, bottom: 14 }, theme: "grid",
    styles: { fontSize: 6.8, cellPadding: 1.6, textColor: C.text, lineColor: C.panelLine, lineWidth: 0.2 },
    headStyles: { fillColor: C.darkBlue, textColor: "#FFFFFF", halign: "center", fontStyle: "bold" },
    alternateRowStyles: { fillColor: C.rowAlt }, columnStyles: { 0: { cellWidth: 50 } },
    head: [["ASSESSMENT CONTROL", "BASIS USED"]],
    body: [
      ["Required tests", "Mandatory test cases for All or Equity Market without an agreed exemption are required."],
      ["Client evidence", "The order, client order and execution IDs in the client's report are looked up in the messages. A required test with no evidence must be supplied and retested."],
      ["Message and field validation", `Message types, codes and field values are checked against ${REFERENCE}.`],
      ["Timing and correlation", "The orders must be sent by the CompID in the report, and the report's test time must be within 5 minutes of the messages. Logon and mass cancel tests use the CompID's messages within 10 minutes of the test time."],
      ["Pass criteria", "Every configured check must pass. A rejection, a missing response, a wrong CompID or a wrong field value causes failure. When the exported messages do not settle the result, a JSE analyst decides."],
      ["Traceability", "Each result shows the configured criteria, what the messages show and the reason for Pass or Fail."],
      ["Messages checked", "JSE Trading FIX message data, 01/07/2026 to 30/09/2026."],
    ].map((row) => row.map(pdfText)),
  });
}

const SECTIONS = [
  { result: RESULTS.PASS, key: "passed", title: "PASSED TESTS - CRITERIA AND OBSERVED EVIDENCE",
    subtitle: "Each result shows exactly what was checked and why the test passed.", line: C.green, light: C.passLight,
    conclusion: () => "PASS. All configured checks passed." },
  { result: RESULTS.FAIL, key: "failed", title: "FAILED TESTS - CRITERIA AND OBSERVED EVIDENCE",
    subtitle: "Each result shows exactly what was checked, why the test failed and what must be corrected.", line: C.red, light: C.failLight,
    conclusion: (r) => `FAIL. ${criteriaFor(r).redo}` },
  { result: RESULTS.REVIEW, key: "review", title: "TESTS FOR JSE REVIEW - CRITERIA AND OBSERVED EVIDENCE",
    subtitle: "The exported messages do not settle these results. A JSE analyst decides each one.", line: C.orange, light: C.reviewLight,
    conclusion: () => "NEEDS REVIEW. A JSE analyst decides the result from the messages." },
  { result: RESULTS.NOT_ATTEMPTED, key: "missing", title: "REQUIRED TESTS NOT ATTEMPTED",
    subtitle: "The client gave no evidence for these required tests. Each must be run and its evidence supplied.", line: C.missing, light: C.missingLight,
    conclusion: (r) => `NOT ATTEMPTED. Run this required test and record the IDs of its messages in the report.${r.clientComment ? ` The client's comment must be explained.` : ""}` },
];

// The rows of one test's table.
function testRows(r, section) {
  const k = criteriaFor(r);
  const given = [r.compid ? `CompID ${r.compid}` : "", r.time ? `test time ${r.time}` : ""].filter(Boolean).join(", ");
  const shows = r.shows ? r.shows.replace(/\n/g, " ") : "";
  const observed = r.result === RESULTS.NOT_ATTEMPTED
    ? (r.clientComment ? `No evidence. The client wrote: "${r.clientComment}".` : "No evidence. The client gave no response for this test.")
    : [r.reason, shows.length > 700 ? `${shows.slice(0, 700)}...` : shows].filter(Boolean).join("\n");
  return [
    ["TEST", `${r.id} - ${r.title}`],
    ["REQUEST", `${k.request}${given ? ` Client report: ${given}.` : ""}`],
    ["RESPONSE", k.response],
    ["CONFIGURED CRITERIA", k.criteria],
    ["ACTUAL OBSERVED", observed],
    ["CONCLUSION", section.conclusion(r)],
  ].map((row) => row.map(pdfText));
}

// The height a test's table needs, so a table that does not fit on the page starts on the next one.
function rowsHeight(doc, rows) {
  doc.setFontSize(6.8);
  const lineH = 6.8 * 0.3528 * 1.15;
  return rows.reduce((h, [, value]) => h + Math.max(1, doc.splitTextToSize(value, INNER - 45).length) * lineH + 3.4, 0);
}

function section(doc, s, tests) {
  doc.addPage();
  pageTitle(doc, s.title, s.subtitle);
  let y = 30;
  for (const r of tests) {
    const rows = testRows(r, s);
    if (y + rowsHeight(doc, rows) > PAGE_H - 16) { doc.addPage(); y = 14; }
    doc.autoTable({
      startY: y, margin: { left: M, right: M, top: 14, bottom: 14 }, theme: "grid", body: rows,
      styles: { fontSize: 6.8, cellPadding: { top: 1.7, bottom: 1.7, left: 2.5, right: 2.5 }, textColor: C.text, lineColor: s.line, lineWidth: 0.15 },
      columnStyles: { 0: { cellWidth: 40 } },
      didParseCell: (d) => {
        if (d.row.index !== 0) return;
        d.cell.styles.fillColor = s.light;
        if (d.column.index === 0) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fontSize = 8; d.cell.styles.textColor = s.line; }
      },
    });
    doc.setDrawColor(s.line);
    doc.setLineWidth(0.5);
    if (doc.lastAutoTable.finalY > y) doc.rect(M, y, INNER, doc.lastAutoTable.finalY - y);
    y = doc.lastAutoTable.finalY + 4;
  }
  return y;
}

function approval(doc, c, a, y) {
  const lines = [];
  if (a.failed.length) lines.push(`Repeat all ${plural(a.failed.length, "failed test")}: ${a.failed.map((r) => r.id).join(", ")}.`);
  if (a.missing.length) lines.push(`Run and supply evidence for ${plural(a.missing.length, "required test")} not attempted: ${a.missing.map((r) => r.id).join(", ")}.`);
  if (a.review.length) lines.push(`A JSE analyst decides ${plural(a.review.length, "test")}: ${a.review.map((r) => r.id).join(", ")}.`);
  lines.push(lines.length ? "Approval requires complete results and every configured criterion to pass." : "Every assessed test passed every configured criterion.");
  doc.setFontSize(8.5);
  const text = doc.splitTextToSize(pdfText(lines.join(" ")), INNER - 10);
  const h = 9 + text.length * 3.7;
  if (y + h + 10 > PAGE_H - 14) { doc.addPage(); y = 14; }
  doc.setFillColor(C.noteFill);
  doc.setDrawColor(C.orange);
  doc.setLineWidth(0.4);
  doc.rect(M, y, INNER, h, "FD");
  doc.setTextColor(C.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Approval condition", M + 5, y + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(text, M + 5, y + 9.5);
  const days = [...new Set(a.times.map(longDate))];
  const ref = `${REFERENCE}, and the Trading FIX message data${days.length ? ` for ${days.length > 3 ? `${days.slice(0, 3).join(", ")} and ${days.length - 3} more days` : days.join(", ")}` : ""}. Client report checked: ${c.file}.`;
  doc.setFontSize(6.5);
  labelled(doc, "Assessment reference:", ref, M + 2, y + h + 5, INNER - 2);
}

// The green line at the top and the footer of every page.
function frame(doc) {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(C.green);
    doc.rect(0, 0, PAGE_W, 6, "F");
    doc.setFillColor(C.darkBlue);
    doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
    doc.setTextColor("#FFFFFF");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(FOOTER, M, PAGE_H - 3.2);
    doc.text(`Page ${p}`, PAGE_W - M, PAGE_H - 3.2, { align: "right" });
  }
}

// c: the checked report after the analyst's changes (client_report.js). summary: the JSE comment to the client.
export function buildAssessmentPdf(c, summary = "") {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const a = assess(c);
  firstPage(doc, c, a, summary);
  const shown = SECTIONS.filter((s) => a[s.key].length);
  let y = null;
  for (const s of shown) y = section(doc, s, a[s.key]);
  if (y === null) y = doc.lastAutoTable.finalY + 6;
  approval(doc, c, a, y);
  frame(doc);
  return doc.output("blob");
}
