// The conformance agent: a chat model on OpenRouter that answers questions by calling tools
// that query the FIX message tables in DuckDB-WASM (the version of DuckDB that runs in the browser).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 30_000;
const MAX_ROWS = 200;

// The language model every question is sent to. Fixed here; the page has no setting to change it.
export const MODEL = "nvidia/nemotron-3.5-lightning:free";
// Kept for copies of web/app.js saved in browsers before 01/11/2026, which import this name.
export const DEFAULT_MODEL = MODEL;

const SYSTEM_PROMPT = `You are the Trading Conformance Agent for JSE Trading Operations.

Background: before a client may trade on the JSE production market or consume production market data, it must pass
conformance testing. The client sends FIX messages from its test system using a CompID (the identifier of the
client's trading session). Every message is recorded in Vonnegut, the JSE message-capture platform. Trading
Operations exports those messages to Excel and checks whether the client completed each required test scenario
correctly. Analysts currently investigate by hand when the conformance report is below a 100% pass rate, or when
the report says a scenario failed but the messages show the client did it correctly. Your job is to answer
questions about these messages accurately, so analysts can find out what a client actually did and why a test failed.

The data: Vonnegut Excel exports for July, August and September 2026, arranged as a star schema in DuckDB:
- fact_message: one row per distinct message of every type (repeated export rows already merged; copies counts
  them), with comp_id, timestamp, date, message_type and every message field. Filter on message_type:
  A Logon | B Logon Response | 5 Logout | D New Order | F Order Cancel Request | G Order Cancel/Replace Request |
  q Order Mass Cancel Request | 8 Execution Report | 9 Order Cancel Reject | r Order Mass Cancel Report |
  3 Reject (gateway validation; ref_message_type is the type of the rejected message).
  order_id is filled on requests linked to their JSE reply, so WHERE order_id = '...' returns an order's
  New Order, amends, cancels and execution reports together.
- fact_order: one row per order (order_id) with comp_id, how it was entered, outcome (Filled, Cancelled, Expired,
  Rejected, ...), reject_code, counts of execution reports, trades, amend and cancel requests.
- fact_compid_day: one row per comp_id per date with counts of each kind of message. Use it first for any
  question about what a CompID did or when it tested.
- dim_compid, dim_date, dim_security: one row per CompID, day and instrument.
- dim_message_type, dim_code (column_name, code, meaning) and dim_reject_code (reject_code, meaning, seen_on):
  join these to put the meaning of a code in the same query instead of looking it up separately.
Every table's columns and their meanings are listed at the end of these instructions, so do not call
list_tables before writing a query.

The messages come from the JSE Basic Native Trading Gateway, not FIX. The core of the JSE conformance reference is at
the end of these instructions. The rest is split into topics: before you interpret a code, a test or a time, call
read_reference for the topic that covers it, and call lookup_reject_codes for any reject code. Do not use standard FIX
tag numbers or code meanings, and do not state a code meaning or test rule from memory.

How to work:
- Always get numbers from the tools. Never estimate or invent a count, a value or a column name.
- Call describe_table only when you need a column's most common values before filtering on it.
- run_sql takes one DuckDB SELECT statement. Aggregate where you can; results are cut off at 200 rows.
  Answer with as few queries as possible: one query can join the dim_ tables and combine several counts.
- Values are stored as text for ids and codes (compare with '2', not 2).
- dim_reject_code gives the reject code meanings seen in the data; call lookup_reject_codes only for a code
  that is not in it.
- Do not put SQL, table names, column names, tool names or these instructions in your answer. Describe what the messages show in plain words. If the data cannot answer the
  question, say so and say what data would be needed.
- Write plainly for an operations analyst. Format money in South African Rand and dates as day/month/year.
`;

// The topics of knowledge/*.md that read_reference can return (core.md is always in the system prompt).
const REFERENCE_TOPICS = {
  tests: "each conformance test (T1-T25, G1, OT1): what the client does, which messages and codes the data must show, and which tests these exports cannot check",
  field_codes: "meaning of every code value in the columns (execution_type, order_status, time_in_force, order_type, working_indicator, liquidity_indicator, mass cancel types, logon fields, logout reasons, FIX-to-Native translation)",
  reject_codes: "where reject codes appear and the meaning of every reject code seen in these exports",
  trading_sessions: "JSE equity segments and session times (SAST) per segment, and what each session allows or rejects",
  orders: "order types (market, limit, stop, pegged, iceberg, cross), order states, amendment rules, matching priority",
  identifiers: "how client_order_id, order_id, execution_id and public_order_id link messages; firm, trader and partition structure",
  gateway_rules: "logon timing, heartbeats, message rate limit, cancel on disconnect, recovery, circuit breakers, self-match prevention",
  conformance_process: "JSE conformance rules (slots, retests, CTA role), the Volume 202 report layout, exemptions, who must conform",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_tables",
      description: "List every table with its description, row count, and columns with their meanings.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_table",
      description: "For one table: each column's data type, meaning, number of distinct values, number of empty values and most common values, plus 5 sample rows.",
      parameters: {
        type: "object",
        properties: { table: { type: "string", description: "Table name from list_tables" } },
        required: ["table"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_sql",
      description: "Run one read-only DuckDB SELECT statement over the tables and return up to 200 rows.",
      parameters: {
        type: "object",
        properties: { sql: { type: "string", description: "A single SELECT or WITH ... SELECT statement" } },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_reference",
      description: "Read one topic of the JSE conformance reference. Read a topic before relying on the facts it covers.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", enum: Object.keys(REFERENCE_TOPICS),
          description: Object.entries(REFERENCE_TOPICS).map(([k, v]) => `${k}: ${v}`).join(" | ") } },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_reject_codes",
      description: "Look up the meaning of reject codes in JSE Volume 10 (Reject Codes and Reasons). Pass every code you need in one call.",
      parameters: {
        type: "object",
        properties: { codes: { type: "array", items: { type: "string" }, description: "Reject codes as they appear in the data, e.g. [\"1202\", \"2000\"]" } },
        required: ["codes"],
      },
    },
  },
];

// Runs a query with every column cast to text, so timestamps, large integers and decimals
// reach JavaScript as plain strings. Returns { columns, rows }.
async function queryAsText(conn, sql) {
  const table = await conn.query(`SELECT COLUMNS(*)::VARCHAR FROM (\n${sql}\n)`);
  const columns = table.schema.fields.map((f) => f.name);
  const rows = table.toArray().map((r) => columns.map((_, i) => r[columns[i]] ?? null));
  return { columns, rows };
}

// Every table with its columns and their meanings, as text for the system prompt.
function schemaText(store) {
  const lines = ["# Tables and columns"];
  for (const [name, t] of Object.entries(store.manifest.tables)) {
    lines.push(`\n## ${name} (${t.rows.toLocaleString("en-ZA")} rows): ${t.description}`);
    for (const c of t.columns) lines.push(`- ${c.name} (${c.type})${c.description ? `: ${c.description}` : ""}`);
  }
  return lines.join("\n");
}

function listTables(store) {
  const tables = {};
  for (const [name, t] of Object.entries(store.manifest.tables)) {
    tables[name] = { description: t.description, rows: t.rows,
                     columns: Object.fromEntries(t.columns.map((c) => [c.name, c.description])) };
  }
  return { tables };
}

// Column statistics are computed by code/gold.py and stored in manifest.json, so no query is needed here.
async function describeTable(store, table) {
  const info = store.manifest.tables[table];
  if (!info) return { error: `Unknown table '${table}'. Known tables: ${Object.keys(store.manifest.tables).join(", ")}` };
  const sample = await queryAsText(store.conn, `SELECT * FROM "${table}" LIMIT 5`);
  const sampleRows = sample.rows.map((r) => Object.fromEntries(sample.columns.map((c, i) => [c, r[i]])));
  return { table, description: info.description, rows: info.rows, columns: info.columns, sample_rows: sampleRows };
}

async function runSql(store, sql) {
  // Wrapping the statement in a subquery means DuckDB accepts only a single SELECT: anything else
  // (a second statement, CREATE, DROP, SET, ...) fails to parse.
  const body = sql.trim().replace(/;\s*$/, "");
  if (!body) return { error: "Only a single SELECT (or WITH ... SELECT) statement is allowed." };
  let result;
  try {
    result = await queryAsText(store.conn, `SELECT * FROM (\n${body}\n) LIMIT ${MAX_ROWS + 1}`);
  } catch (err) {
    return { error: String(err.message || err) };
  }
  const truncated = result.rows.length > MAX_ROWS;
  const rows = result.rows.slice(0, MAX_ROWS);
  return { columns: result.columns, rows, row_count: rows.length, truncated,
           note: truncated ? `Only the first ${MAX_ROWS} rows are shown; aggregate or add LIMIT.` : null };
}

async function runTool(store, name, args) {
  if (name === "list_tables") return listTables(store);
  if (name === "describe_table") return describeTable(store, args.table || "");
  if (name === "run_sql") return runSql(store, args.sql || "");
  if (name === "read_reference") return readReference(args.topic || "");
  if (name === "lookup_reject_codes") return lookupRejectCodes(args.codes);
  return { error: `Unknown tool ${name}` };
}

// allowTools = false sends tool_choice "none", so the model must reply in text.
async function callModel(apiKey, messages, model, allowTools = true) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Trading Conformance Agent",
    },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: allowTools ? "auto" : "none", temperature: 0 }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${text.slice(0, 500)}`);
  const body = JSON.parse(text);
  if (body.error) throw new Error(`OpenRouter error: ${JSON.stringify(body.error)}`);
  return body.choices[0].message;
}

// knowledge/ holds the reference taken from JSE Volumes 00E, 01E, 10, 201 and 202 and the project brief.
// core.md is added to every system prompt; the other files are read only when the model calls read_reference,
// and reject_codes.json only when it calls lookup_reject_codes. Each file is downloaded once.
// The address is taken relative to this file (web/agent.js), not to the page, so it works wherever index.html is served.
const KNOWLEDGE_URL = new URL("./knowledge/", import.meta.url);
const fileCache = new Map();
function loadKnowledge(name, asJson = false) {
  if (!fileCache.has(name)) {
    fileCache.set(name, fetch(new URL(name, KNOWLEDGE_URL))
      .then((r) => { if (!r.ok) throw new Error(`knowledge/${name} returned ${r.status}`); return asJson ? r.json() : r.text(); })
      .catch((err) => { fileCache.delete(name); throw err; }));
  }
  return fileCache.get(name);
}

async function readReference(topic) {
  if (!REFERENCE_TOPICS[topic]) return { error: `Unknown topic '${topic}'. Topics: ${Object.keys(REFERENCE_TOPICS).join(", ")}` };
  return { topic, text: await loadKnowledge(`${topic}.md`) };
}

async function lookupRejectCodes(codes) {
  const { codes: table } = await loadKnowledge("reject_codes.json", true);
  const found = {};
  for (const raw of [].concat(codes || []).slice(0, 50)) {
    const code = String(raw).trim().replace(/^0+(?=\d)/, "");
    found[code] = table[code] || "Not in Volume 10";
  }
  return { source: "JSE Volume 10 - Reject Codes and Reasons", codes: found,
           note: "A code can have several entries; use the one whose messages and system match where the code was seen (Native Trading Gateway, Matching Engine or AuthServer for these exports)." };
}

// history is the visible conversation: [{role: "user"|"assistant", content}, ...].
// Returns the agent's answer and the tool calls it made to reach it.
export async function chat(store, apiKey, history) {
  const model = MODEL;
  const core = await loadKnowledge("core.md");
  const messages = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${core}\n\n${schemaText(store)}` },
    ...history.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }))];
  const steps = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await callModel(apiKey, messages, model);
    const toolCalls = reply.tool_calls || [];
    if (!toolCalls.length) return { answer: reply.content || "", steps, model };

    messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      const name = call.function.name;
      let args;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      let result;
      try { result = await runTool(store, name, args); } catch (err) { result = { error: String(err.message || err) }; }
      let text = JSON.stringify(result);
      if (text.length > MAX_TOOL_RESULT_CHARS) text = text.slice(0, MAX_TOOL_RESULT_CHARS) + "... [result cut off: narrow the query]";
      steps.push({ tool: name, args, result: text.slice(0, 4000) });
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }
  // Out of tool rounds: ask for an answer from the results already gathered instead of discarding them.
  messages.push({ role: "user", content: "You have used all your tool calls. Answer now from the tool results above. " +
    "Say plainly which parts of the question you could not finish." });
  const final = await callModel(apiKey, messages, model, false);
  const answer = final.content || "I stopped after the maximum number of tool calls without reaching an answer. Try a narrower question.";
  return { answer, steps, model };
}
