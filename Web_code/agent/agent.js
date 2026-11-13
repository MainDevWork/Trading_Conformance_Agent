// The conformance agent: a chat model on OpenRouter that answers questions by calling tools
// that query the FIX message tables in DuckDB-WASM (the version of DuckDB that runs in the browser).
// Before the first model request, retrieve.js queries the tables and reads reference topics for what the question
// names, and sends the results with the question, so the model needs fewer rounds of tool calls.
// When the analyst has attached a client's conformance test report, the results of checking it (conformance.js) are
// sent with every question, and two more tools let the model read the messages of one test step and write the
// report to send back to the client.
// Memory (memory.js keeps it in the browser): the notes saved in earlier conversations, and the summary of the
// conversation this one continues, are sent with every question, and three tools let the model save a note, delete
// one and search earlier conversations.
// Speed: a request to the model is the slow step, so the agent makes as few as it can. A question that the results of
// an attached report already answer gets no request at all (direct_answer.js). Replies are streamed, so the page shows
// the answer as the model writes it.

import { retrieve } from "./retrieve.js?v=27";
import { evidenceFor, resultsText } from "../reports/conformance.js?v=27";
import { isSmallTalk } from "./retrieve.js?v=27";
import { directAnswer } from "../reports/direct_answer.js?v=27";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 30_000;
const MAX_ROWS = 200;
// A model request that sends nothing for this long is stopped, so the page never waits without a limit.
const MODEL_TIMEOUT_MS = 120_000;
// After this long since the question was sent, no new tool round starts: the next request has tools switched off and
// the model must answer from the results it already has.
const TOOL_TIME_LIMIT_MS = 60_000;

// The language model every question is sent to. Fixed here; the page has no setting to change it.
export const MODEL = "nvidia/nemotron-3.5-lightning:free";
// Kept for copies of Web_code/ui/app.js saved in browsers before 01/11/2026, which import this name.
export const DEFAULT_MODEL = MODEL;

// The most tokens (pieces of words, about 4 characters each) one request to MODEL may hold, as OpenRouter's model
// list gave it on 04/11/2026.
export const MODEL_CONTEXT_TOKENS = 1_000_000;
// The context bar on the page measures the conversation against this smaller number. Published tests of long inputs
// found that models answer less accurately as a request grows, long before the model's limit: in the NoLiMa test
// (Modarressi et al., 2025), 10 of 12 models scored less than half their short-request score at 32,000 tokens.
// The bar turns amber at CONTEXT_WARN_TOKENS and red at CONTEXT_LIMIT_TOKENS, and the page then advises starting a
// new conversation that continues from a summary of this one.
export const CONTEXT_WARN_TOKENS = 32_000;
export const CONTEXT_LIMIT_TOKENS = 64_000;

// The fixed part of every request: the same text, in the same order, for every question and every round, so a
// provider that keeps a copy of a repeated prompt start can reuse it. Facts that change per question are sent with
// the question instead (see retrieve.js).
const SYSTEM_PROMPT = `You are the Trading Conformance Agent for JSE Trading Operations.

Background: before a client may trade on the JSE production market or consume production market data, it must pass
conformance testing. The client sends messages from its test system using a CompID (the identifier of the client's
trading session). Every message is captured and stored by the JSE. Trading Operations exports
those messages to Excel and checks whether the client completed each required test scenario correctly. Analysts
investigate by hand when the conformance report is below a 100% pass rate, or when the report says a scenario failed
but the messages show the client did it correctly. Your job is to answer questions about these messages accurately,
so analysts can find out what a client actually did and why a test failed.

The data: the Trading FIX message data of July, August and September 2026 as a star schema in DuckDB. Call it the
Trading FIX message data; do not name the system that captured the messages. The core JSE conformance
reference and every table's columns with their meanings are at the end of these instructions. Start from
fact_compid_day for what a CompID did and on which days, fact_message for single messages, fact_order for whole orders.

A question may come with a block headed "Retrieved for this question": facts already queried from the data, with
the SQL that produced them, and reference topics already read. Use it first. Do not run a query or read a topic that
the block already answers; adapt its SQL when you need a variation.

How to work:
- Get every number from the retrieved block or from run_sql. Never estimate or invent a count, a value or a column name.
- Decide which queries you need before calling tools, and put tool calls that do not depend on each other in one reply.
- run_sql takes one DuckDB SELECT statement and returns at most 200 rows. Aggregate, and combine several counts in one query.
- IDs and codes are text: compare with '2', not 2.
- Rejections: filter on is_rejection, never on reject_code alone. Code meanings are in the _name columns; join
  dim_reject_code for reject code meanings, and call lookup_reject_codes only for a code that is not in it.
- What happened in an execution report: use report_event (execution_type is empty in July, order_status in August).
- The messages come from the JSE Basic Native Trading Gateway, not FIX. Before you interpret a test, a session time or a
  code, read its reference topic with read_reference unless the retrieved block holds it. Do not use standard FIX tag
  numbers or code meanings, and do not state a code meaning or test rule from memory.
- Call describe_table only when you need a column's most common values before filtering on it.

Talking with the analyst: you are also someone the analyst can simply talk to. When the message is a greeting, thanks
or small talk ("Hello", "thanks", "how are you?"), reply briefly and naturally, in one or two sentences, as a
colleague would, and say what you can help with if it fits. Do not query the data, call a tool or repeat an earlier
answer for such a message. In every reply, do only what the message asks: never start an analysis of a CompID, test
or month that the message does not name or clearly refer to.

Example queries (ABC123 stands for the CompID the analyst names; never use it as a real CompID):
-- Rejections of one CompID in August, with their meanings
SELECT f.reject_code, r.meaning, f.message_type_name, count(*) AS messages
FROM fact_message f LEFT JOIN dim_reject_code r USING (reject_code)
WHERE f.comp_id = 'ABC123' AND f.is_rejection AND f.date BETWEEN '2026-08-01' AND '2026-08-31'
GROUP BY ALL ORDER BY messages DESC
-- Every message of one order, in time order
SELECT timestamp, message_type_name, report_event, client_order_id, reject_code FROM fact_message
WHERE order_id = 'O0SnTxKEgvzy' ORDER BY timestamp
-- How a CompID's orders ended
SELECT outcome, count(*) AS orders FROM fact_order WHERE comp_id = 'ABC123' GROUP BY 1 ORDER BY 2 DESC
-- The days a CompID tested, and what it did on each
SELECT date, messages, logons, new_orders, amend_requests, cancel_requests, order_rejects, gateway_rejects
FROM fact_compid_day WHERE comp_id = 'ABC123' ORDER BY date

An attached client report: an analyst can attach a client's Volume 202 conformance test report (Excel or PDF). When
the analyst sends a question with it, the page checks every test step the client answered against the messages, by
fixed rules, and sends the results with each question in a block headed "Attached client conformance test report".
Each test step has a result: Pass, Fail, Needs review, Not checkable or Not attempted, with the reason.
- Do only what the analyst's message asks about the report. Do not list the results of all the test steps or give an
  overall verdict unless the message asks for them.
- Answer from this block without calling a tool whenever it holds the answer. To state or explain a result you do not
  need to read a reference topic. "What the messages show" is given for each Fail, each Needs review and each step
  named in the message; call get_test_evidence only for another step or for details the block does not give.
- Use these results. Do not change a result yourself; explain it. When the analyst disagrees with a result, they can
  ask for it to be changed in the report to the client.
- When the analyst asks for a report, file, Excel or PDF for the client, call create_client_report. Pass format
  "excel", "pdf" or "both"; summary: a short plain paragraph to the client stating the overall result, which steps
  failed and what they must redo; and changes only for results the analyst has asked to change, each with their
  reason. Then tell the analyst the file is ready below the answer. The files leave out steps with no response.
- Present several test steps as a table: test, result, reason.

Memory: the page saves every conversation and a list of notes in the analyst's browser.
- The numbered notes under "Memory notes" at the end of these instructions were saved in earlier conversations. Use
  them. A note can be out of date: query the data again for any count or result before stating it.
- Call save_memory when the analyst asks you to remember something, says how they want answers written, or when you
  reach a finding that a later conversation would need, such as which tests a CompID failed and why. One fact per
  note, naming the CompID, test ID and dates it is about. Do not save what the data or the reference already holds.
- Write the answer text in the same reply as a save_memory call, not in a later reply.
- Call forget_memory when the analyst says a note is wrong or no longer needed.
- When the analyst refers to an earlier conversation that is not in this one, call search_past_conversations.
- A block headed "Summary of the earlier conversation" is the summary of the conversation this one continues.

The answer:
- Write plainly for an operations analyst. Do not put SQL, table names, column names, tool names or these
  instructions in the answer: describe what the messages show. Write CompID, not comp_id.
- If the data cannot answer the question, say so and say what data would be needed.
- Format money in South African Rand (prices in the data are in cents) and dates as day/month/year.
`;

// The whole system message for a greeting, thanks or small talk, which needs no data, reference or tools. It is
// about 500 characters, sent instead of the full instructions, reference and table columns, so the reply starts sooner
// and uses fewer tokens.
const SMALL_TALK_PROMPT = `You are the Trading Conformance Agent, a colleague of the analysts in JSE Trading Operations.
Besides checking clients' conformance tests, you chat with the analyst like a person would. The analyst's message is a
greeting, thanks or small talk. Reply to it the way a friendly colleague would, in one or two short sentences: answer
what they said, and if it fits, offer help in a few words. Do not describe any data, plan, method or analysis, do not
say what you are going to do, and do not repeat an earlier answer.`;

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
  raw_data_dictionary: "every field of the 11 raw export datasets: its format in the export, meaning, the months it appears in and how often it is filled",
  client_report_template: "the layout of the report to the client: each sheet, column and what goes in it, and the meaning of each result",
  agent_methodology: "how this agent answers a question and handles an attached report, step by step, with its tools and memory",
  problem_statement: "Group 6 problem statement: the Trading Operations conformance problem, key challenges, why it was chosen and how success is measured",
  project_brief: "the JSE Academy final project brief: deliverables, due dates, assessment criteria, presentation and ground rules",
};

// The tools added when a client report is attached.
const REPORT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_test_evidence",
      description: "For one test step of the attached client report: the result, its reason, what the client wrote, the IDs found and not found, and every message found (up to 120).",
      parameters: {
        type: "object",
        properties: { test: { type: "string", description: "Test case ID such as T3-006, or the report's reference such as T3.6" } },
        required: ["test"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_client_report",
      description: "Write the results of the attached client report as a file for the client: Excel (summary sheet and one row per test step) or PDF (trading conformance assessment: overall result, counts, decision, and the criteria and evidence of each passed, failed and review test). Steps with no client response are left out of both. The page shows a download link below the answer.",
      parameters: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["excel", "pdf", "both"] },
          summary: { type: "string", description: "A short plain paragraph to the client: the overall result, which steps failed and what to redo" },
          changes: {
            type: "array",
            description: "Only results the analyst asked to change",
            items: {
              type: "object",
              properties: {
                test: { type: "string", description: "Test case ID or reference" },
                result: { type: "string", enum: ["Pass", "Fail", "Needs review", "Not checkable"] },
                reason: { type: "string", description: "The analyst's reason" },
              },
              required: ["test", "result"],
            },
          },
        },
        required: ["format", "summary"],
      },
    },
  },
];

// The memory tools, sent with every question.
const MEMORY_TOOLS = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save one short fact (at most 500 characters) to the memory notes, which are sent with every question of every later conversation.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The fact, naming the CompID, test ID and dates it is about" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_memory",
      description: "Delete one memory note by its number.",
      parameters: {
        type: "object",
        properties: { number: { type: "integer", description: "The note's number, as listed under Memory notes" } },
        required: ["number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_past_conversations",
      description: "Search the analyst's earlier conversations for words such as a CompID, a test ID or a month. Returns up to 5 conversations with passages around the words found.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The words to search for, e.g. \"LCNN13 T25-001\"" } },
        required: ["query"],
      },
    },
  },
];

const TOOLS = [
  {
    type: "function",
    function: {
      name: "describe_table",
      description: "For one table: each column's data type, meaning, number of distinct values, number of empty values and most common values, plus 5 sample rows.",
      parameters: {
        type: "object",
        properties: { table: { type: "string", description: "Table name, as listed at the end of the instructions" } },
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
      description: "Read one topic of the JSE conformance reference. Read a topic before relying on the facts it covers, unless it is already in the retrieved block.",
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
    // A column such as side_name beside side is listed once, as "side (+ side_name)", not on a line of its own.
    const all = new Set(t.columns.map((c) => c.name));
    const named = (c) => all.has(`${c}_name`) || (c === "message_type" && all.has("message_type_name"));
    for (const c of t.columns) {
      if (c.name.endsWith("_name") && all.has(c.name.slice(0, -5))) continue;
      lines.push(`- ${c.name}${named(c.name) ? ` (+ ${c.name}_name, its meaning)` : ""} ${c.type}${c.description ? `: ${c.description}` : ""}`);
    }
  }
  return lines.join("\n");
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
  // The tables never change while the page is open, so a statement the model already ran returns the saved result
  // instead of reading the tables again. At most 100 results are kept.
  store.sqlResults ??= new Map();
  if (store.sqlResults.has(body)) return store.sqlResults.get(body);
  let result;
  try {
    result = await queryAsText(store.conn, `SELECT * FROM (\n${body}\n) LIMIT ${MAX_ROWS + 1}`);
  } catch (err) {
    return { error: String(err.message || err) };
  }
  const truncated = result.rows.length > MAX_ROWS;
  const rows = result.rows.slice(0, MAX_ROWS);
  const answer = { columns: result.columns, rows, row_count: rows.length, truncated,
                   note: truncated ? `Only the first ${MAX_ROWS} rows are shown; aggregate or add LIMIT.` : null };
  if (store.sqlResults.size >= 100) store.sqlResults.delete(store.sqlResults.keys().next().value);
  store.sqlResults.set(body, answer);
  return answer;
}

async function runTool(store, name, args, attachment, memory) {
  if (name === "get_test_evidence" && attachment) return evidenceFor(attachment.checked, args.test);
  if (name === "create_client_report" && attachment) return attachment.makeReport(args);
  if (name === "save_memory" && memory) return memory.save(args.text);
  if (name === "forget_memory" && memory) return memory.forget(args.number);
  if (name === "search_past_conversations" && memory) return memory.search(args.query);
  if (name === "describe_table") return describeTable(store, args.table || "");
  if (name === "run_sql") return runSql(store, args.sql || "");
  if (name === "read_reference") return readReference(args.topic || "");
  if (name === "lookup_reject_codes") return lookupRejectCodes(args.codes);
  return { error: `Unknown tool ${name}` };
}

// What the page shows while each tool runs.
const STEP_TEXT = {
  describe_table: "Reading a table's columns",
  run_sql: "Running a database query",
  read_reference: "Reading the JSE conformance reference",
  lookup_reject_codes: "Looking up reject codes",
  get_test_evidence: "Reading the messages of a test step",
  create_client_report: "Writing the report for the client",
  save_memory: "Saving a memory note",
  forget_memory: "Deleting a memory note",
  search_past_conversations: "Searching earlier conversations",
};

// The system message: the fixed instructions, core reference and table columns first, so they are the same at the
// start of every request; then the memory notes and the carried summary, which change only between conversations
// or when a note is saved.
function systemText(store, core, memory) {
  let text = `${SYSTEM_PROMPT}\n\n${core}\n\n${schemaText(store)}`;
  if (memory?.notes?.length) {
    text += `\n\n# Memory notes\n${memory.notes.map((n) => `[${n.id}] (saved ${n.saved.slice(0, 10)}) ${n.text}`).join("\n")}`;
  }
  if (memory?.carried) text += `\n\n# Summary of the earlier conversation this one continues\n${memory.carried}`;
  return text;
}

function toolsFor(attachment, memory) {
  return [...TOOLS, ...(attachment ? REPORT_TOOLS : []), ...(memory ? MEMORY_TOOLS : [])];
}

// The number of characters of the request the next question starts with: the system message, the tool definitions,
// the conversation so far and the results of an attached report. The facts retrieve.js adds to the next question,
// and the tool results of its rounds, are not counted, because they are not known before it is asked.
// The page multiplies this by the tokens per character of the last request to show the context bar.
export async function startingChars(store, history, attachment = null, memory = null) {
  const core = await loadKnowledge("core.md");
  const turns = history.map((m) => ({ role: m.role, content: m.content }));
  let chars = JSON.stringify({ messages: [{ role: "system", content: systemText(store, core, memory) }, ...turns],
                               tools: toolsFor(attachment, memory) }).length;
  if (attachment) chars += resultsText(attachment.checked).length;
  return chars;
}

// Each request asks the model to skip its reasoning step, which it would otherwise write and wait for before the
// answer. OpenRouter refuses this for a model whose reasoning cannot be switched off; the page then stops asking.
let reasoningOff = true;

// An error from OpenRouter itself, as opposed to a failed connection.
class OpenRouterError extends Error {}

// Reads a streamed reply: lines "data: {json}" with pieces of the text and of the tool calls, ending with "data: [DONE]".
// Lines starting with ":" only keep the connection open. onPiece() is called for each piece received,
// onText(textSoFar) when the text grows, and onThinking(words) when a model whose reasoning step cannot be switched
// off sends a piece of its reasoning before any text, with the number of words of reasoning so far.
async function readStream(response, onPiece, onText, onThinking) {
  const reply = { content: "", usage: null };
  let thought = 0;
  const calls = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      // The reply is complete at [DONE]: reading stops there, even if the connection is not closed straight away, so
      // the page never waits for the connection to time out after the answer has been shown.
      if (data === "[DONE]") { finished = true; break; }
      const chunk = JSON.parse(data);
      if (chunk.error) throw new OpenRouterError(`OpenRouter error: ${JSON.stringify(chunk.error)}`);
      if (chunk.usage) reply.usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      onPiece();
      const reasoning = delta.reasoning || delta.reasoning_content;
      if (reasoning && !reply.content) { thought += (reasoning.match(/\S+/g) || []).length; onThinking(thought); }
      if (delta.content) { reply.content += delta.content; onText(reply.content); }
      for (const piece of delta.tool_calls || []) {
        const call = calls[piece.index ?? calls.length] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.function.name += piece.function.name;
        if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
      }
    }
  }
  if (finished) reader.cancel().catch(() => {});
  const toolCalls = calls.filter(Boolean);
  if (toolCalls.length) reply.tool_calls = toolCalls;
  return reply;
}

// allowTools = false sends tool_choice "none", so the model must reply in text.
// onText(textSoFar) is called as the reply's text is received. stopSignal (an AbortSignal), when it fires, cancels the
// request: the analyst pressed Stop.
// Returns the reply message and usage: the token counts OpenRouter reports for the request and the reply.
async function callModel(apiKey, messages, model, allowTools = true, tools = TOOLS, onText = () => {}, stopSignal = null, onThinking = () => {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (stopSignal?.aborted) cancel();
  stopSignal?.addEventListener("abort", cancel);
  let timer;
  const restartTimer = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS); };
  restartTimer();
  const post = () => fetch(OPENROUTER_URL, {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Trading Conformance Agent",
    },
    // A request with no tools (the summary) sends neither tools nor tool_choice.
    body: JSON.stringify({ model, messages, stream: true, ...(reasoningOff ? { reasoning: { effort: "none" } } : {}),
                           ...(tools.length ? { tools, tool_choice: allowTools ? "auto" : "none" } : {}), temperature: 0 }),
  });
  try {
    let response = await post();
    if (response.status === 400 && reasoningOff) {
      const text = await response.clone().text();
      if (/reasoning/i.test(text)) { reasoningOff = false; response = await post(); }
    }
    if (!response.ok) throw new OpenRouterError(`OpenRouter returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
    if ((response.headers.get("content-type") || "").includes("text/event-stream")) return await readStream(response, restartTimer, onText, onThinking);
    // A reply sent whole, not streamed.
    const body = JSON.parse(await response.text());
    if (body.error) throw new OpenRouterError(`OpenRouter error: ${JSON.stringify(body.error)}`);
    if (body.choices[0].message.content) onText(body.choices[0].message.content);
    return { ...body.choices[0].message, usage: body.usage || null };
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    if (err.name === "AbortError") throw new Error(`The language model sent nothing for ${MODEL_TIMEOUT_MS / 1000} seconds. Send the question again.`);
    throw new Error(`Could not reach OpenRouter: ${err.message || err}`);
  } finally {
    clearTimeout(timer);
    stopSignal?.removeEventListener("abort", cancel);
  }
}

// knowledge/ holds the reference taken from JSE Volumes 00E, 01E, 10, 201 and 202 and the project brief.
// core.md is added to every system prompt; the other files are read only when the model calls read_reference,
// and reject_codes.json only when it calls lookup_reject_codes. Each file is downloaded once.
// The address is taken relative to this file (Web_code/agent/agent.js), not to the page, so it works wherever index.html is served.
const KNOWLEDGE_URL = new URL("../knowledge/", import.meta.url);
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

// The error that ends an answer when the analyst presses Stop. The page keeps the text written so far.
const STOPPED = "Stopped by the analyst.";

// Plain words for the names that appear most often in answers; any other name has its underscores replaced by spaces.
const PLAIN_NAMES = { comp_id: "CompID", is_rejection: "rejection", reject_code: "reject code", fact_message: "the messages",
                      fact_order: "the orders", fact_compid_day: "the daily activity of each CompID" };

// Table names, and column names that contain an underscore, are replaced in an answer with plain words, with no
// request to the model. The instructions forbid them, and smaller models sometimes include them anyway.
export function plainNames(store, answer) {
  const names = new Set(Object.keys(store.manifest.tables));
  for (const t of Object.values(store.manifest.tables)) for (const c of t.columns) if (c.name.includes("_")) names.add(c.name);
  return answer.replace(/`?\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`?/g, (text) => {
    const word = text.replace(/`/g, "");
    if (!names.has(word)) return text;
    return PLAIN_NAMES[word] || word.replace(/^(fact|dim)_/, "").replace(/_name$/, "").replace(/_/g, " ");
  });
}

const hasSql = (answer) => /\bSELECT\b[\s\S]{1,400}?\bFROM\b/.test(answer);

// Tools whose result needs no reply from the model: a report file was written, or a note saved or deleted in a reply
// that already holds the answer. A reply shorter than MIN_ANSWER_CHARS is treated as an opening remark, not the answer.
const FINAL_TOOLS = new Set(["create_client_report", "save_memory", "forget_memory"]);
const MIN_ANSWER_CHARS = 200;
const FILE_READY = "The report for the client is ready to download below.";

// history is the visible conversation: [{role: "user"|"assistant", content}, ...]; the last entry is the new question.
// onStep(text) is called before each step, so the page can show what is happening.
// attachment, when a client report is attached: { checked (from conformance.js checkReport), makeReport(args) }.
// memory: { notes (from memory.js listNotes), carried (a summary or null), save(text), forget(number), search(query) }.
// onText(textSoFar) is called as the model writes a reply, so the page can show it.
// Returns the agent's answer, the steps it took to reach it, tokens: for the first request, its prompt tokens
// as OpenRouter counted them and its length in characters; for the largest request, its prompt tokens; and timing:
// the number of requests to the model and the milliseconds spent waiting for them.
// stopSignal (an AbortSignal), when it fires, ends the answer with an error at the next step.
export async function chat(store, apiKey, history, onStep = () => {}, attachment = null, memory = null, onText = () => {}, stopSignal = null) {
  const model = MODEL;
  const checkStop = () => { if (stopSignal?.aborted) throw new Error(STOPPED); };
  const startedAt = Date.now();
  const core = await loadKnowledge("core.md");
  const turns = history.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
  const steps = [];
  const timing = { requests: 0, modelMs: 0 };
  const onThinking = (words) => onStep(`The language model is thinking (${words} words so far)`);

  // A question the results of the attached report already answer gets no request to the model.
  const asked = turns[turns.length - 1].content;
  const direct = attachment ? directAnswer(attachment.checked, asked) : null;
  if (direct) {
    let answer = direct.text;
    if (direct.format) {
      onStep(STEP_TEXT.create_client_report);
      await attachment.makeReport({ format: direct.format });
      answer = FILE_READY;
    }
    return { answer, steps: [{ tool: "direct_answer", args: {}, result: "" }], model: null, timing,
             tokens: { firstPrompt: null, firstChars: 0, largestPrompt: 0 } };
  }

  // A greeting, thanks or small talk gets one reply with no retrieval and no tools.
  const smallTalk = isSmallTalk(asked);
  // Retrieval: the facts and reference topics for what the question names are added to the question.
  if (!smallTalk) onStep("Finding the data and reference for the question");
  const question = turns[turns.length - 1];
  const earlier = turns.slice(0, -1).filter((m) => m.role === "user").map((m) => m.content);
  const found = smallTalk ? { text: "" } : await retrieve(store, question.content, earlier, async (topic) => (await readReference(topic)).text, Boolean(attachment));
  checkStop();
  if (found.text) {
    question.content = `${question.content}\n\n${found.text}`;
    steps.push({ tool: "retrieve", args: { compids: found.compids, months: found.months, codes: found.codes, topics: found.topics },
                 result: found.text.slice(0, 4000) });
  }
  if (attachment && !smallTalk) question.content = `${question.content}

${resultsText(attachment.checked, asked)}`;
  const tools = toolsFor(attachment, memory);

  const messages = [{ role: "system", content: systemText(store, core, memory) }, ...turns];
  const tokens = { firstPrompt: null, firstChars: JSON.stringify({ messages, tools }).length, largestPrompt: 0 };
  const count = (reply) => {
    const prompt = reply.usage?.prompt_tokens;
    if (!prompt) return;
    if (tokens.firstPrompt === null) tokens.firstPrompt = prompt;
    tokens.largestPrompt = Math.max(tokens.largestPrompt, prompt);
  };
  const ask = async (allowTools, sent = messages, sentTools = tools) => {
    const sentAt = Date.now();
    const reply = await callModel(apiKey, sent, model, allowTools, sentTools, onText, stopSignal, onThinking);
    timing.requests++;
    timing.modelMs += Date.now() - sentAt;
    count(reply);
    return reply;
  };
  let answer = null;
  if (smallTalk) {
    onStep("Replying");
    // Only the short system message and the conversation are sent: no tables, reference, memory notes or tools.
    const short = [{ role: "system", content: SMALL_TALK_PROMPT }, ...turns.slice(-6)];
    answer = (await ask(false, short, [])).content || "Hello. Ask me about a CompID's conformance test messages, or attach a client's report.";
  }
  for (let round = 0; round < MAX_TOOL_ROUNDS && answer === null; round++) {
    if (round > 0 && Date.now() - startedAt > TOOL_TIME_LIMIT_MS) break;
    onStep(`Waiting for the language model's reply (request ${round + 1})`);
    const reply = await ask(true);
    const toolCalls = reply.tool_calls || [];
    if (!toolCalls.length) { answer = reply.content || ""; break; }

    messages.push({ role: "assistant", content: reply.content || null, tool_calls: toolCalls });
    let failed = false;
    for (const call of toolCalls) {
      checkStop();
      const name = call.function.name;
      let args;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      onStep(STEP_TEXT[name] || `Running ${name}`);
      let result;
      try { result = await runTool(store, name, args, attachment, memory); } catch (err) { result = { error: String(err.message || err) }; }
      if (result?.error) failed = true;
      let text = JSON.stringify(result);
      if (text.length > MAX_TOOL_RESULT_CHARS) text = text.slice(0, MAX_TOOL_RESULT_CHARS) + "... [result cut off: narrow the query]";
      steps.push({ tool: name, args, result: text.slice(0, 4000) });
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
    // No further request when the tools called need no reply from the model.
    if (!failed && toolCalls.every((c) => FINAL_TOOLS.has(c.function.name))) {
      const wrote = (reply.content || "").trim();
      const long = wrote.length >= MIN_ANSWER_CHARS;
      if (toolCalls.some((c) => c.function.name === "create_client_report")) answer = long ? `${wrote}\n\n${FILE_READY}` : FILE_READY;
      else if (long) answer = wrote;
    }
  }
  if (answer === null) {
    // Out of tool rounds: ask for an answer from the results already gathered instead of discarding them.
    messages.push({ role: "user", content: "You have used all your tool calls. Answer now from the tool results above. " +
      "Say plainly which parts of the question you could not finish." });
    onStep("Waiting for the language model's final answer");
    const final = await ask(false);
    answer = final.content || "I stopped after the maximum number of tool calls without reaching an answer. Try a narrower question.";
  }

  // Plain-words check: table and column names are replaced here; an answer that holds SQL is rewritten once, with
  // tools switched off.
  answer = plainNames(store, answer);
  if (hasSql(answer)) {
    onStep("Rewriting the answer in plain words");
    messages.push({ role: "assistant", content: answer });
    messages.push({ role: "user", content: "Rewrite your answer above for the analyst. It contains SQL: remove it and describe in plain words " +
      "what it does. Keep every number, date and conclusion unchanged, and do not add anything." });
    const rewrite = await ask(false);
    steps.push({ tool: "rewrite", args: {}, result: "" });
    if (rewrite.content) answer = plainNames(store, rewrite.content);
  }
  return { answer, steps, model, tokens, timing };
}

// The summary a new conversation starts with when the analyst continues a long conversation in a new one.
// history: the conversation's questions and answers; carried: the summary the conversation itself started with.
// One request with no tools; only the questions and answers are sent, not the tables or the reference.
export async function summarise(apiKey, history, carried = null) {
  const text = [carried ? `Summary of the conversation before this one:\n${carried}` : "",
    ...history.map((m) => `${m.role === "user" ? "Analyst" : "Agent"}: ${m.content}`)].filter(Boolean).join("\n\n");
  const reply = await callModel(apiKey, [
    { role: "system", content: "You write the summary a new conversation of the Trading Conformance Agent starts with. " +
      "The new conversation receives only this summary, not the conversation itself." },
    { role: "user", content: `${text}\n\nSummarise the conversation above in at most 300 words, as a plain list: the CompIDs, ` +
      "months and tests discussed; each finding with its numbers and dates; any result the analyst asked to change in " +
      "the report to the client, with their reason; how the analyst asked for answers to be written; and the questions " +
      "not yet answered. Do not add anything that is not in the conversation." },
  ], MODEL, false, []);
  if (!reply.content) throw new Error("The language model returned an empty summary. Try again.");
  return reply.content;
}
