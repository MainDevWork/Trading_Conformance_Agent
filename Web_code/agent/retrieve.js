// Retrieval before the first model request. The question is searched for the CompIDs, months, reject codes and
// test IDs it names; summary queries are run for them on the in-browser tables, and up to two reference topics are
// chosen by keyword. The results are sent to the model with the question, so the model needs fewer rounds of tool
// calls (each round is a full request to the model). Nothing here calls the model.

// Reference topics chosen by words in the question. Each pattern is matched case-insensitively.
const TOPIC_WORDS = {
  tests: /\btests?\b|scenario|\b(T\d{1,2}|G1|OT1)\b|\bpass|\bfail|conform|sign.?off/i,
  conformance_process: /volume 202|conformance report|retest|\bslot|exempt|\bCTA\b|pass rate/i,
  reject_codes: /reject|refus|\berror/i,
  trading_sessions: /session|auction|opening|closing|intraday|segment|halt|volatility|\bschedule/i,
  orders: /order type|iceberg|pegged|\bstop\b|market order|limit order|amend|\bfill|match|cross/i,
  identifiers: /client order id|clordid|order id|execution id|public order|\blink/i,
  gateway_rules: /log ?on|log ?out|heartbeat|message rate|throttl|disconnect|recover|password|self.?match|circuit/i,
  field_codes: /time in force|\b(IOC|FOK|GTC|GTD|GTT|GFA|ATC|OPG)\b|order status|liquidity|working indicator|protocol version|\bmeaning/i,
  raw_data_dictionary: /data dictionary|raw (data|export|field|dataset)|export (field|column|format)/i,
  client_report_template: /report (template|layout)|template/i,
  agent_methodology: /methodolog|agentic|\bRAG\b|how (do|does) (you|the agent|this agent|this system) work/i,
  problem_statement: /problem statement|group 6|key challenge|key.person/i,
  project_brief: /project brief|final project|academy|assessment criteri|deliverable|due date/i,
};
// With a report attached, its results are already sent with the question, so words such as "test" and "pass" do not
// select these two topics; only a question about a step's rule does.
const TOPIC_WORDS_WITH_REPORT = {
  ...TOPIC_WORDS,
  tests: /\b(T\d{1,2}|G1|OT1)\b|\bwhy\b|\brules?\b|requirement/i,
  conformance_process: /retest|\bslot|exempt|\bCTA\b/i,
};
// Words of a greeting, thanks or other small talk. A message made only of these words asks nothing about the data,
// so it gets no retrieval and no tools (see isSmallTalk).
const SMALL_TALK_WORDS = new Set(("hi hello hey hiya howzit morning afternoon evening good day thanks thank you cheers ok okay " +
  "great nice cool awesome bye goodbye see later how are is it going doing what's whats up who what can do i said to there " +
  "again agent yes no sure please and well fine all right alright too much appreciated welcome sorry the").split(" "));

// True when the message is a greeting, thanks or small talk, such as "Hello", "thanks!" or "how are you?".
export function isSmallTalk(text) {
  const words = String(text).toLowerCase().replace(/[’]/g, "'").match(/[a-z']+/g);
  return Boolean(words) && words.length <= 12 && words.every((w) => SMALL_TALK_WORDS.has(w));
}

const MAX_TOPICS = 2;
const MAX_COMPIDS = 2;

const MONTHS = { 7: /\bjul(y)?\b|\b0?7\/2026\b|\b2026-07\b/i, 8: /\baug(ust)?\b|\b0?8\/2026\b|\b2026-08\b/i,
                 9: /\bsep(t|tember)?\b|\b0?9\/2026\b|\b2026-09\b/i };

// The CompIDs and reject codes in the data, read once per page.
async function lookups(store) {
  if (!store.lookups) {
    const compids = await store.conn.query("SELECT comp_id FROM dim_compid");
    const codes = await store.conn.query("SELECT reject_code, meaning FROM dim_reject_code");
    store.lookups = {
      compids: compids.toArray().map((r) => r.comp_id),
      rejectCodes: new Map(codes.toArray().map((r) => [r.reject_code, r.meaning])),
    };
  }
  return store.lookups;
}

// A query result as a text table: a header line, then one line per row, values separated by " | ".
// The tables never change while the page is open, so each result is kept by its SQL text and a follow-up question
// about the same CompID and months reuses it instead of reading fact_message again. At most 200 results are kept.
const MAX_SAVED_RESULTS = 200;
async function textTable(store, sql) {
  store.savedResults ??= new Map();
  if (store.savedResults.has(sql)) return store.savedResults.get(sql);
  const table = await store.conn.query(`SELECT COLUMNS(*)::VARCHAR FROM (\n${sql}\n)`);
  const columns = table.schema.fields.map((f) => f.name);
  const rows = table.toArray().map((r) => columns.map((c) => r[c] ?? "").join(" | "));
  const text = rows.length ? [columns.join(" | "), ...rows].join("\n") : "(no rows)";
  if (store.savedResults.size >= MAX_SAVED_RESULTS) store.savedResults.delete(store.savedResults.keys().next().value);
  store.savedResults.set(sql, text);
  return text;
}

function findCompids(text, compids) {
  const upper = text.toUpperCase();
  return compids.filter((c) => new RegExp(`\\b${c}\\b`).test(upper));
}

// question: the analyst's new question. earlier: their earlier questions in this conversation, oldest first; a
// follow-up such as "and in September?" uses the CompIDs of the latest earlier question that named one.
// readTopic(topic) returns the text of a reference topic. reportAttached: a client report's results go with the question.
// Returns { text, topics, compids, months, codes }: text is the block sent with the question ("" when nothing matched).
export async function retrieve(store, question, earlier, readTopic, reportAttached = false) {
  const { compids: known, rejectCodes } = await lookups(store);
  let compids = findCompids(question, known);
  // With a report attached, a question that names no CompID is about the report, not an earlier question's CompID.
  for (let i = earlier.length - 1; !reportAttached && !compids.length && i >= 0; i--) compids = findCompids(earlier[i], known);
  compids = compids.slice(0, MAX_COMPIDS);
  const months = Object.keys(MONTHS).filter((m) => MONTHS[m].test(question)).map(Number);
  const codes = [...new Set(question.match(/\b\d{1,6}\b/g) || [])].filter((c) => rejectCodes.has(c) && /code|reject/i.test(question));
  const topics = Object.entries(reportAttached ? TOPIC_WORDS_WITH_REPORT : TOPIC_WORDS)
    .map(([topic, pattern]) => [topic, (question.match(new RegExp(pattern.source, "gi")) || []).length])
    .filter(([, hits]) => hits > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_TOPICS).map(([topic]) => topic);

  const parts = [];
  const monthFilter = months.length ? ` AND month(date) IN (${months.join(", ")})` : "";
  for (const c of compids) {
    const where = `comp_id = '${c}'${monthFilter}`;
    const queries = [
      ["Activity per month", `SELECT strftime(date, '%m/%Y') AS month, count(DISTINCT date) AS days_active, min(timestamp) AS first_message, max(timestamp) AS last_message, count(*) AS messages, count(*) FILTER (WHERE is_rejection) AS rejections FROM fact_message WHERE ${where} GROUP BY 1 ORDER BY 1`],
      ["Messages per type", `SELECT message_type, message_type_name, count(*) AS messages, count(*) FILTER (WHERE is_rejection) AS rejections FROM fact_message WHERE ${where} GROUP BY ALL ORDER BY messages DESC`],
      ["Rejections per reject code", `SELECT f.reject_code, r.meaning, f.message_type_name, count(*) AS messages FROM fact_message f LEFT JOIN dim_reject_code r USING (reject_code) WHERE f.is_rejection AND ${where} GROUP BY ALL ORDER BY messages DESC LIMIT 40`],
      ["Order outcomes", `SELECT outcome, count(*) AS orders FROM fact_order WHERE comp_id = '${c}'${months.length ? ` AND month(first_report_at) IN (${months.join(", ")})` : ""} GROUP BY 1 ORDER BY 2 DESC`],
    ];
    parts.push(`## CompID ${c}${months.length ? `, ${months.map((m) => `${String(m).padStart(2, "0")}/2026`).join(" and ")}` : ", all months"}`);
    for (const [title, sql] of queries) parts.push(`### ${title}\nSQL: ${sql}\n${await textTable(store, sql)}`);
  }
  if (codes.length) {
    parts.push("## Reject codes named in the question\n" + codes.map((c) => `${c}: ${rejectCodes.get(c)}`).join("\n"));
  }
  for (const topic of topics) parts.push(`## Reference topic: ${topic}\n${await readTopic(topic)}`);

  const text = parts.length ? "# Retrieved for this question\n" +
    "Facts queried from the data (with the SQL used) and reference topics already read. Use them before calling tools.\n\n" +
    parts.join("\n\n") : "";
  return { text, topics, compids, months, codes };
}
