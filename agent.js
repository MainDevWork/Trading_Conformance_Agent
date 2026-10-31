// The conformance agent: a chat model on OpenRouter that answers questions by calling tools
// that query the FIX message tables in DuckDB-WASM (the version of DuckDB that runs in the browser).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 30_000;
const MAX_ROWS = 200;

export const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

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
The view all_messages holds the common columns of every table, so you can follow one comp_id or client_order_id
across message types in time order.

Tables by FIX MsgType (tag 35):
A logon | B logon_response | 5 logout | D new_order_single | F order_cancel_request |
G order_cancel_replace_request | 8 execution_report | 9 order_cancel_reject | 3 reject (session-level reject) |
q order_mass_cancel_request | r order_mass_cancel_report.
In reject tables, ref_message_type is the type of the message that was rejected (FIX tag 372, RefMsgType).
A file's name does not always match its contents (for example July_2026/'Logout [B].xlsx' contains Logon Response
messages); tables were assigned from the message_type column, not the file name. Not every month has every column.

Standard FIX code values (these are the standard FIX meanings; the JSE trading interface specification may define
JSE-specific values, so say when you are relying on the standard meaning):
Side (54): 1 Buy, 2 Sell. OrdType (40): 1 Market, 2 Limit, 3 Stop, 4 Stop limit.
TimeInForce (59): 0 Day, 1 Good till cancel, 3 Immediate or cancel, 4 Fill or kill, 6 Good till date.
ExecType (150): 0 New, 4 Canceled, 5 Replaced, 8 Rejected, C Expired, F Trade, D Restated.
OrdStatus (39): 0 New, 1 Partially filled, 2 Filled, 4 Canceled, 6 Pending cancel, 8 Rejected, C Expired.

How to work:
- Always get numbers from the tools. Never estimate or invent a count, a value or a column name.
- Start with list_tables if you do not yet know which table or column you need; use describe_table to see a
  column's actual values before filtering on it.
- run_sql takes one DuckDB SELECT statement. Aggregate where you can; results are cut off at 200 rows.
- Values are stored as text for ids and codes (compare with '2', not 2).
- In your answer, say which table and which filter produced each number, and give the SQL you used when it helps
  the analyst check it. If the data cannot answer the question, say so and say what data would be needed.
- Write plainly for an operations analyst. Format money in South African Rand and dates as day/month/year.
`;

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
  return { error: `Unknown tool ${name}` };
}

async function callModel(apiKey, messages, model) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Trading Conformance Agent",
    },
    body: JSON.stringify({ model, messages, tools: TOOLS, temperature: 0 }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${text.slice(0, 500)}`);
  const body = JSON.parse(text);
  if (body.error) throw new Error(`OpenRouter error: ${JSON.stringify(body.error)}`);
  return body.choices[0].message;
}

// history is the visible conversation: [{role: "user"|"assistant", content}, ...].
// Returns the agent's answer and the tool calls it made to reach it.
export async function chat(store, apiKey, history, model) {
  model = model || DEFAULT_MODEL;
  const messages = [{ role: "system", content: SYSTEM_PROMPT },
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
  return { answer: "I stopped after the maximum number of tool calls without reaching an answer. Try a narrower question.",
           steps, model };
}
