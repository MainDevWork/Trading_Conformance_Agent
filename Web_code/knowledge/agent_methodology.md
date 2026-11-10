# Agent methodology: agentic RAG (retrieval-augmented generation with a tool-calling loop)

## Once, when the database key is entered

- A. The analyst enters the database key (`Web_code/ui/app.js`).
- B. The page gets the 9 gold tables from cloud storage, or from the copy saved in this browser.
- C. The page creates the tables in the in-browser database (DuckDB-WASM), with file and network access switched off.

## When a client report is attached

- R1. The analyst attaches the client's report. It is read in the browser and only its name is shown.
- R2. With the first prompt after attaching, each test step is checked against the messages. The client's IDs are looked up in the tables, and each step gets one result by a fixed rule, not from the model.
- R3. A closed section under the first answer, opened by a click, holds the result of each step and the Excel and PDF report buttons. The results are kept until the report is removed.

## For every question

1. The analyst asks a question, which is added to the conversation. If a report is attached and every word of the question is on a fixed list, such as "give me the results", "what failed" or "give me the excel report", the page writes the table or the report file from the fixed-rule results with no request to the model: go to step 10.
2. The agent retrieves before asking the model (`Web_code/agent/retrieve.js`): summary queries on the in-browser tables and reference topics, added to the question.
3. The agent builds the request: the same instructions, example queries, core reference and table columns every time, plus the memory notes and the conversation. It offers 7 tools, or 9 with a report.
4. The agent sends the request to the language model, `nvidia/nemotron-3.5-lightning:free`, with its reasoning step switched off. The reply is streamed, so the page shows the answer as the model writes it. While the agent answers, a Stop button replaces the Send button: it cancels the request and keeps the text written so far in the conversation, marked as stopped, so the analyst can send a different prompt.
5. Does the reply call any tools? If not, the reply is the answer: go to step 9.
6. The agent runs each tool call on the in-browser tables or the reference files.
7. The agent adds the results to the conversation, each cut to at most 200 rows and 30,000 characters. No further request is sent after a report file is written, or after a note is saved in a reply that holds the full answer: go to step 9.
8. Have 12 requests been used, or 60 seconds passed since the question? If not, the next round starts at step 4. If so, one last request is sent with tools switched off, and the model must answer from the results it already has.
9. Does the answer contain SQL? If so, one rewrite request is sent with tools off: the same numbers and conclusions, in plain words. Table and column names are replaced with plain words with no request.
10. The page shows the answer text, how long it took and how many requests the model received. The queries are not shown.
11. The page saves the conversation in the browser and updates the context bar (`Web_code/agent/memory.js`).

## What step 2 adds to the question

- A CompID named in the question or in an earlier question: activity per month, messages per type, rejections per reject code with meanings, and how its orders ended.
- A month: the same facts for that month only.
- A reject code: its meaning.
- Words such as test, session or logon: up to 2 topics. With a report attached, the tests topic is added only for a question that names a test or asks why, or asks about a rule or requirement.
- An attached report: the result of every test step, and what the messages show only for steps that Fail, Need review or are named in the question.

## The tools the model can call

| Tool | What it does |
| --- | --- |
| `run_sql` | Runs one SELECT query on the tables |
| `describe_table` | Common values of each column |
| `read_reference` | One JSE reference topic |
| `lookup_reject_codes` | Reject code meanings |
| `get_test_evidence` | Added when a report is attached: messages of one test step |
| `create_client_report` | Added when a report is attached: Excel or PDF file |
| `save_memory` | Always sent: saves one memory note |
| `forget_memory` | Always sent: deletes a note |
| `search_past_conversations` | Always sent: finds earlier conversations by their words |

## Memory, kept in this browser (IndexedDB)

- Every conversation: questions, answers and attached reports. The last one is opened again after a reload, and the sidebar lists the rest.
- Memory notes: facts the model saved with `save_memory`, sent with every question of every conversation (step 3).
- Context bar: the tokens the next request starts with, counted by OpenRouter for the last request. Amber from 32,000, red from 64,000. The model accepts 1,000,000.
- Continue in a new conversation: one request with no tools writes a summary of at most 300 words. The new conversation starts with it and sends it with every question.
- Memory is not shared with other computers or analysts, and is deleted when the browser's site data is cleared.
