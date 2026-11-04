// Reads a client's conformance test report (JSE Volume 202) uploaded to the chat page: an Excel file (.xlsx, .xls)
// or a PDF. The file is read in the browser and is not uploaded anywhere. Returns the test steps of the report, one
// object per row, with what the client wrote in each column.

// The libraries are downloaded only when the first file of their kind is attached.
const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const scripts = new Map();
export function loadScript(url, globalName) {
  if (!scripts.has(url)) {
    scripts.set(url, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => resolve(window[globalName]);
      s.onerror = () => { scripts.delete(url); s.remove(); reject(new Error(`Could not download ${new URL(url).hostname}: check that the browser is not blocking it.`)); };
      document.head.append(s);
    }));
  }
  return scripts.get(url);
}

// A test step ID in Volume 202: T3-001, I5-001, G1-001, OT1-001.
const TEST_ID = /^(?:[A-Z]{1,2}\d{1,2})-\d{3}$/;

// Volume 202 column headings, matched to the names used in this page. A report may have extra or moved columns,
// so columns are found by their heading, not by their position.
const HEADINGS = [
  ["id", /^test case id$/i],
  ["market", /^markets?$/i],
  ["mandatory", /^mandatory\b/i],
  ["exemption", /exemption/i],
  ["selfCta", /self.*cta/i],
  ["requirements", /^requirements$/i],
  ["compid", /compid|user id/i],
  ["ip", /ip address/i],
  ["time", /test time/i],
  ["field1", /required field\s*1/i],
  ["field2", /required field\s*2/i],
  ["field3", /required field\s*3/i],
  ["clientComment", /client comment/i],
  ["jseComment", /jse comment/i],
  ["result", /pass\s*\/\s*fail|test result/i],
];

const clean = (v) => String(v ?? "").replace(/�/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();

function readSheet(name, rows) {
  const headerAt = rows.findIndex((r) => r.some((c) => /^test case id$/i.test(clean(c))));
  if (headerAt < 0) return null;
  const header = rows[headerAt].map(clean);
  const col = {};
  for (const [key, pattern] of HEADINGS) {
    const i = header.findIndex((h, j) => pattern.test(h) && !Object.values(col).includes(j));
    if (i >= 0) col[key] = i;
  }
  // The test description column is headed "Trading Conformance", "Information Conformance (Market Data)" and so on.
  const title = header.findIndex((h) => /conformance/i.test(h) && !/exemption/i.test(h));
  col.title = title >= 0 ? title : col.id + 1;

  const tests = [];
  let group = "";
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r].map(clean);
    const get = (key) => (col[key] === undefined ? "" : row[col[key]] || "");
    const id = get("id");
    if (!TEST_ID.test(id)) {
      if (row[0] && get("title")) group = get("title");
      continue;
    }
    tests.push({
      sheet: name, row: r + 1, ref: row[0] || "", id, group, title: get("title"),
      market: get("market"), mandatory: get("mandatory"), exemption: get("exemption"), selfCta: get("selfCta"),
      requirements: get("requirements"), compid: get("compid"), ip: get("ip"), time: get("time"),
      fields: [get("field1"), get("field2"), get("field3")].filter(Boolean),
      clientComment: get("clientComment"), jseComment: get("jseComment"), result: get("result"),
    });
  }
  return { name, tests };
}

async function readExcel(file) {
  const XLSX = await loadScript(SHEETJS_URL, "XLSX");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = [];
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "", blankrows: true });
    const sheet = readSheet(name, rows);
    if (sheet && sheet.tests.length) sheets.push(sheet);
  }
  return sheets;
}

// A PDF has no cells, only pieces of text placed on pages, and one piece can hold the text of two neighbouring
// cells. The tables are rebuilt from where each piece sits:
// - a table starts at its heading row, found by the word "Requirements". Its columns are the pieces of the heading
//   row that start at the same distance from the left edge, named by the words in them ("Case", "Mandatory",
//   "CompID", "Test Time" ...). A table with no heading row on its page uses the last heading row seen;
// - a row starts at a reference in the first column (T1, T1.1, I5.1 ...) and ends where the next one starts, and
//   each piece in it belongs to the column whose heading starts nearest to its left;
// - a test ID split over two lines ("T1-" and "001") is joined, and one not in the ID column is found in the row.
// The rebuilt rows are then read the same way as an Excel sheet.
const REF = /^([A-Z]{1,2}\d{1,2}(?:\.\d{1,2})?)(?:\s|$)/;
const PDF_HEADINGS = [
  ["Test Case ID", /\bcase\b/i], ["Mandatory", /^mandatory/i], ["Conformance Exemption", /exemption/i],
  ["Requirements", /^requirements/i], ["Trading Conformance", /conformance/i], ["Market", /^markets?\b/i],
  ["Self / CTA", /^self/i], ["Client Interface User ID (CompID)", /compid|user id/i], ["Client IP Address", /ip address/i],
  ["Test Time", /^test time/i], ["Required Field1", /field\s*1/i], ["Required Field2", /field\s*2/i],
  ["Required Field3", /field\s*3/i], ["Client Comment", /client comment/i], ["JSE Comment", /^jse/i],
  ["Test Result Pass / Fail", /result|pass\s*\//i],
];

function joinPieces(pieces) {
  // Top to bottom; a piece that ends with "-" is joined to the next without a space ("T1-" + "001").
  return pieces.sort((a, b) => b.y - a.y || a.x - b.x)
    .reduce((text, p) => (text && !text.endsWith("-") ? `${text} ${p.str}` : text + p.str), "").trim();
}

function columnsOf(pieces) {
  const columns = [];
  for (const p of [...pieces].sort((a, b) => a.x - b.x)) {
    const last = columns[columns.length - 1];
    if (last && p.x - last.x <= 4) last.pieces.push(p);
    else columns.push({ x: p.x, pieces: [p] });
  }
  return columns.map((c) => {
    const text = joinPieces(c.pieces);
    const found = PDF_HEADINGS.find(([, pattern]) => pattern.test(text));
    return { x: c.x, heading: found ? found[0] : "" };
  });
}

async function readPdf(file) {
  const pdfjs = await import(PDFJS_URL);
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    // Browsers refuse to start a worker from another site's address, so the worker is started from a local blob
    // that imports it.
    const blob = new Blob([`import "${PDFJS_WORKER_URL}";`], { type: "text/javascript" });
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(blob), { type: "module" });
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const tables = [];
  let table = null;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const pieces = (await page.getTextContent()).items.filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    const refs = pieces.filter((p) => REF.test(p.str));
    if (!refs.length) continue;
    const left = Math.min(...refs.map((p) => p.x));
    const anchors = refs.filter((p) => p.x - left <= 6).sort((a, b) => b.y - a.y);
    // Heading rows on this page, top to bottom: the pieces between the word "Requirements" (up to 45 points above
    // it) and the first row below it.
    const marks = pieces.filter((p) => /^requirements$/i.test(p.str)).sort((a, b) => b.y - a.y);
    const headings = marks.map((m) => {
      const below = anchors.find((a) => a.y < m.y - 2);
      const floor = below ? below.y + 3 : -Infinity;
      return { y: m.y, columns: columnsOf(pieces.filter((p) => p.y > floor && p.y <= m.y + 45)) };
    });
    anchors.forEach((anchor, i) => {
      const heading = headings.filter((h) => h.y > anchor.y).pop();
      if (heading && (!table || table.heading !== heading)) {
        table = { heading, columns: heading.columns, rows: [] };
        tables.push(table);
      }
      if (!table) return;
      const nextHeading = headings.find((h) => h.y < anchor.y);
      const bottom = Math.max(i + 1 < anchors.length ? anchors[i + 1].y + 2 : -Infinity, nextHeading ? nextHeading.y + 45 : -Infinity);
      const band = pieces.filter((p) => p.y <= anchor.y + 2 && p.y > bottom);
      const cells = table.columns.map(() => []);
      for (const p of band) {
        let best = 0;
        table.columns.forEach((c, j) => { if (c.x <= p.x + 4 && c.x >= table.columns[best].x) best = j; });
        cells[best].push(p);
      }
      const row = cells.map(joinPieces);
      // Searched before the reference cell is trimmed below, because a piece can hold the reference and the start
      // of the test ID ("T3.09 T3-").
      const idCol = table.columns.findIndex((c) => c.heading === "Test Case ID");
      if (idCol >= 0 && !TEST_ID.test(row[idCol])) {
        const id = row.join(" ").match(/\b([A-Z]{1,2}\d{1,2})-\s*(\d{3})\b/);
        if (id) row[idCol] = `${id[1]}-${id[2]}`;
      }
      row[0] = anchor.str.match(REF)[1];
      table.rows.push(row);
    });
  }
  return tables.map((t, i) => readSheet(`PDF table ${i + 1}`, [t.columns.map((c) => c.heading), ...t.rows]))
    .filter((s) => s && s.tests.length);
}

// Returns { name, kind, sheets: [{ name, tests }], tests } where each test is
// { sheet, row, ref, id, group, title, market, mandatory, exemption, selfCta, requirements, compid, ip, time,
//   fields: [text, ...], clientComment, jseComment, result }.
export async function readAttachment(file) {
  const name = file.name;
  let sheets;
  if (/\.(xlsx|xlsm|xls)$/i.test(name)) sheets = await readExcel(file);
  else if (/\.pdf$/i.test(name)) sheets = await readPdf(file);
  else throw new Error(`${name}: only Excel (.xlsx, .xls) and PDF files can be attached.`);
  const tests = sheets.flatMap((s) => s.tests);
  if (!tests.length) {
    throw new Error(`${name}: no test steps were found. The page reads Volume 202 conformance test reports, which have a column headed "Test Case ID".`);
  }
  return { name, kind: /\.pdf$/i.test(name) ? "PDF" : "Excel", sheets, tests };
}
