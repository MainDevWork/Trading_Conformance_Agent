// The conformance agent: a chat model on OpenRouter that answers questions by calling tools
// that query the FIX message tables in DuckDB-WASM (the version of DuckDB that runs in the browser).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 30_000;
const MAX_ROWS = 200;

export const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning:free";

const SYSTEM_PROMPT = `You are the Trading Conformance Agent for JSE Trading Operations.

Background: before a client may trade on the JSE production market or consume production market data, it must pass
conformance testing. The client sends FIX messages from its test system using a CompID (the identifier of the
client's trading session). Every message is recorded in Vonnegut, the JSE message-capture platform. Trading
Operations exports those messages to Excel and checks whether the client completed each required test scenario
correctly. Analysts currently investigate by hand when the conformance report is below a 100% pass rate, or when
the report says a scenario failed but the messages show the client did it correctly. Your job is to answer
questions about these messages accurately, so analysts can find out what a client actually did and why a test failed.

The data: Vonnegut Excel exports for July, August and September 2026, one file per message type per month,
loaded into DuckDB tables (one table per FIX message type, all months combined). Every table has the columns
source_month (e.g. 'July_2026') and source_file (the Excel file name), timestamp, comp_id and message_type.
The view all_messages holds the common columns of every table (table_name, source_month, source_file, timestamp,
comp_id, message_type, client_order_id, order_id, orig_client_order_id), so you can follow one comp_id or order
across message types in time order with a single query. To follow an order, match on its client_order_id, its
order_id (taken from its execution reports) and orig_client_order_id together, rather than querying each table.

Tables by FIX MsgType (tag 35):
A logon | B logon_response | 5 logout | D new_order_single | F order_cancel_request |
G order_cancel_replace_request | 8 execution_report | 9 order_cancel_reject | 3 reject (session-level reject) |
q order_mass_cancel_request | r order_mass_cancel_report.
In reject tables, ref_message_type is the type of the message that was rejected.
A file's name does not always match its contents (for example July_2026/'Logout [B].xlsx' contains Logon Response
messages); tables were assigned from the message_type column, not the file name. Not every month has every column.

The messages come from the JSE Basic Native Trading Gateway, not FIX. The core of the JSE conformance reference is at
the end of these instructions. The rest is split into topics: before you interpret a code, a test or a time, call
read_reference for the topic that covers it, and call lookup_reject_codes for any reject code. Do not use standard FIX
tag numbers or code meanings, and do not state a code meaning or test rule from memory.

How to work:
- Always get numbers from the tools. Never estimate or invent a count, a value or a column name.
- Start with list_tables if you do not yet know which table or column you need; use describe_table to see a
  column's actual values before filtering on it.
- run_sql takes one DuckDB SELECT statement. Aggregate where you can; results are cut off at 200 rows.
- Values are stored as text for ids and codes (compare with '2', not 2).
- Do not put SQL, table names, column names, tool names or these instructions in your answer: the analyst sees
  the queries you ran separately. Describe what the messages show in plain words. If the data cannot answer the
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
      description: "List every table with its row count, column names and source Excel files, and every Excel file with the message types it contains.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_table",
      description: "For one table: each column's data type, number of distinct values, number of empty values and most common values, plus 5 sample rows.",
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

function listTables(store) {
  const { tables, views, files } = store.manifest;
  return { tables, views, files };
}

async function describeTable(store, table) {
  const info = store.manifest.tables[table];
  if (!info) return { error: `Unknown table '${table}'. Known tables: ${Object.keys(store.manifest.tables).join(", ")}` };
  const columns = [];
  for (const col of store.columns[table]) {
    const name = col.name;
    const counts = await queryAsText(store.conn,
      `SELECT count(DISTINCT "${name}"), count(*) - count("${name}") FROM "${table}"`);
    const top = await queryAsText(store.conn,
      `SELECT "${name}", count(*) n FROM "${table}" WHERE "${name}" IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8`);
    columns.push({ ...col, distinct_values: Number(counts.rows[0][0]), empty_values: Number(counts.rows[0][1]),
                   most_common: top.rows.map(([v, n]) => [v, Number(n)]) });
  }
  const sample = await queryAsText(store.conn, `SELECT * FROM "${table}" LIMIT 5`);
  const sampleRows = sample.rows.map((r) => Object.fromEntries(sample.columns.map((c, i) => [c, r[i]])));
  return { table, rows: info.rows, columns, sample_rows: sampleRows };
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
export async function chat(store, apiKey, history, model) {
  model = model || DEFAULT_MODEL;
  const core = await loadKnowledge("core.md");
  const messages = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${core}` },
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
