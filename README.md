# Trading Conformance Agent

> [!NOTE]
> This system works with a data set of real JSE trading FIX messages from conformance testing between 01/07/2026 and 30/09/2026. The CompIDs are the only fictitious part of the data: each real CompID has been replaced with a made-up one. Every other value is real trading FIX message data.

> [!IMPORTANT]
> To see and test the system you need two keys: one for the database and one for the AI model. To request them, send me a LinkedIn connection request at [linkedin.com/in/ndivhuwo-makhavhu](https://www.linkedin.com/in/ndivhuwo-makhavhu) with a note that asks for the keys and states why you want to test the system. Keys are given only to people currently employed at a company.

Website: [maindevwork.github.io/Trading_Conformance_Agent](https://maindevwork.github.io/Trading_Conformance_Agent/)

A web chat page where a JSE Trading Operations analyst asks questions about the Trading FIX message data from conformance testing (July to September 2026), and a language model answers them by running SQL queries against those exports.

## Time to complete a client report

By hand, a Trading Operations analyst takes about three days, sometimes more, to complete one client's conformance report. Each test case takes an hour or more, and three tasks add hours that the analyst does not control:

| Task done by hand | Why it adds time | What this system does instead |
| --- | --- | --- |
| Finding each test case's messages and results in the internal trading system | The analyst searches the system test case by test case | Looks up every ID in the client's report in the message data and checks every test step by a fixed rule for that test, when the first prompt is sent with the report |
| Waiting for the IT department when the internal system fails | The work stops until IT fixes the fault | Works from the exported message data, loaded into the browser, so a fault in the internal system after the export does not stop the check |
| Sending the client queries about details of the report and its results | Each query waits for the client's reply and a discussion | The analyst asks the agent, which answers from the messages and states what the messages show for each test step, so fewer queries go to the client |

With this system one client report is completed in under one hour, and in at most two hours, against about three days by hand. The line under each answer on the page states how long that answer took.

## Folders

| Path               | Contents                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`     | The page. Stays in the root so GitHub Pages serves it as the site's home page.                                                                                                                                                                                                                        |
| `Web_code/ui/` | The chat screen: `app.js` (chat, keys form, attached reports, sidebar button), `style.css`, `icon.svg` (the agent's icon, also the browser tab icon) |
| `Web_code/agent/` | The agent: `agent.js` (language model and its tools), `retrieve.js` (facts and reference found before the model is asked), `data.js` (loads the data into the browser), `memory.js` (saved conversations and memory notes, in the browser) |
| `Web_code/reports/` | Client reports: `attachments.js` (reads an attached client report), `conformance.js` (checks it against the messages), `direct_answer.js` (answers from the results with no request to the model), `client_report.js` (writes the Excel report to the client), `assessment_pdf.js` (writes the PDF report to the client) |
| `Web_code/knowledge/` | The JSE conformance reference the agent reads (see below)                                                                                                                                                                                                                                             |
| `code/` | Not in this repository (excluded by `.gitignore`). The Python scripts that build the bronze, silver and gold layers in Supabase. Needed only to rebuild the tables, not to run the page |
| `Pages/`  | The diagram pages: `project_brief.html` (the problem, what the system does, the data), `system_architecture.html`, `agent_methodology.html`, `data_architecture.html`, `bronze_data_diagram.html` (bronze layer), `silver_layer.html` (silver layer), `gold_star_schema.html` (gold layer)                                                                    |
| `academy/sql/` | Not in this repository (excluded by `.gitignore`). SQL Server stored procedures that build the same tables from the Excel files |
| `Clients_Conformance_Tests/` | Clients' Volume 202 reports with real CompIDs. Excluded from git. `Fictitious_CompIDs/` in it holds copies with the fictitious CompIDs, as Excel and PDF, made by `code/anonymise_reports.py`; use only these with the page |
| `.nojekyll`      | Tells GitHub Pages to serve the files as they are; must stay in the root                                                                                                                                                                                                                              |

## Use the page

The page runs entirely in the browser and needs only a static web server, such as GitHub Pages. To run it on your own computer, run `python -m http.server` in the repository root and open http://localhost:8000.

Click **Enter keys** in the sidebar and enter two keys in the form that opens. Neither is saved: enter them again after reloading the page.

| Key on the page | What to enter                                                                     | Use                                                                                                         |
| --------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Database key    | The Supabase publishable key (starts `sb_publishable_`). Never the service key. | `Web_code/agent/data.js` uses it to download the message data from the private Supabase Storage bucket `fix-data`. |
| AI API key      | An OpenRouter key (starts `sk-or-v1-`)                                          | `Web_code/agent/agent.js` sends it only to openrouter.ai, with each question.                                        |

Every question is sent to the model `nvidia/nemotron-3.5-lightning:free`, set as `MODEL` in `Web_code/agent/agent.js`. The page has no setting to change it.

## Check a client's conformance test report

A client sends its Volume 202 conformance test report: one row per test step, with the CompID, test time and IDs (order ID, client order ID, execution ID) the client recorded. To check it:

1. Click the paperclip button beside the question box, or drop the file on the chat area. Excel (`.xlsx`, `.xls`) and PDF files are read, in the browser; the file is not uploaded anywhere.
2. `Web_code/reports/attachments.js` finds each test step by the column headed "Test Case ID", and the other columns by their headings, so moved or extra columns do not matter. A PDF has no columns, so the table is rebuilt from where each piece of text is on the page. The page shows the file's name above the question box and does nothing else with the file until a prompt is sent. A file with no prompt sent yet is not saved, so it must be attached again after a reload.
3. When the analyst sends a prompt, `Web_code/reports/conformance.js` looks up every ID the client wrote in `fact_message`, collects every message of those orders, and gives each step one result by a fixed rule for that test (from `Web_code/knowledge/tests.md`):

   | Result | Meaning |
   | --- | --- |
   | Pass | The messages show the step was done as Volume 202 requires. |
   | Fail | The messages show it was not, or the report's IDs belong to another CompID. The reason says what is wrong. |
   | Needs review | The messages do not settle it: some messages are not in the export, a column is empty in that month's export, or the report's test time is more than 5 minutes from the messages. |
   | Not checkable | The step uses a gateway or service whose messages are not exported (market data, Post Trade, Drop Copy, FIX, derivatives). |
   | Not attempted | The client gave no response. Shown in the chat only; the Excel and PDF reports leave these steps out. |

4. A prompt that the results alone answer, such as "give me the results", "what failed", "result of T3.6" or "give me the excel report", is answered by `Web_code/reports/direct_answer.js` with no request to the model. It answers only when every word of the prompt is on its fixed lists; any other prompt goes to the model. The results are sent to the model with such a prompt and every later one, with what the messages show only for steps that Fail, Need review or are named in the prompt, and the model is told to do only what the prompt asks. The model has two more tools: `get_test_evidence` (every message of one step) and `create_client_report`. A closed section under the first answer, opened by a click, holds the result of each step.
5. The **Excel report** and **PDF report** buttons in that section, or asking the agent for a report, write the file for the client. Steps the client gave no response for are left out of both files.
   - Excel: a summary sheet, then one row per test step with its result and reason.
   - PDF: the trading conformance assessment, in the layout of `Updates/WKP_Trading_Conformance_Client_Report_Card_Format.pdf`. Page 1 holds the overall result, the counts (required tests, evidence provided, passed, failed, pass rate, retest or fix), the decision with a ring chart of the share of tests passed, and the controls the check applies. Then one section each for passed, failed and review tests, with a table per test: the request and response the test needs, the criteria its rule applies (`criteriaFor` in `Web_code/reports/conformance.js`), what the messages show, and the conclusion. It ends with the approval condition.

   The analyst can ask the agent to change a result; the report then says the analyst changed it and keeps the automatic reason. The layout is in `Web_code/knowledge/client_report_template.md`. The two file libraries (ExcelJS and jsPDF) are downloaded while the report is checked, so writing a file does not wait for them.

The September 2026 export has no time in force or order quantity on new orders and no liquidity indicator on execution reports, so tests that need those (for example T21-001) get Needs review, with what the timing of the messages shows.

To make the fictitious copies of new client reports, put the reports in `Clients_Conformance_Tests/` and run `python code/anonymise_reports.py`. It replaces every real CompID from `CompID_Key.xlsx`, in the cells, comments and file name. It stops without writing a copy if the CompID column holds a CompID that is not in the key. A copy whose original file name holds no CompID is named after its most used CompID, because the name may hold another client identifier.

## How a question is answered

1. When the database key is entered, `Web_code/agent/data.js` downloads `gold/manifest.json` and the gold Parquet tables from Supabase (Parquet is a compressed file format for tables), and loads them into DuckDB-WASM, the version of the DuckDB SQL database that runs in the browser.
2. `Web_code/agent/retrieve.js` searches the question for the CompIDs, months, reject codes and test IDs it names. A follow-up question that names no CompID uses the CompID of the latest earlier question that did. For each CompID (at most 2) it runs four summary queries on the in-browser tables: activity per month, messages per type, rejections per reject code with their meanings, and how the CompID's orders ended, limited to the months named. It adds the meaning of each reject code named and up to 2 topic files from `Web_code/knowledge/`, chosen by words in the question. The results, with the SQL that produced them, are added to the question. No language model is involved in this step.
3. `Web_code/agent/agent.js` sends the conversation to OpenRouter. The system prompt starts with the same text in every request: instructions with four example queries, `Web_code/knowledge/core.md`, and every table's columns with their meanings. After it come the memory notes and, in a conversation that continues an earlier one, that conversation's summary (see "Memory and the context bar"). The model may call four tools, plus the three memory tools:
   - `run_sql`: one SELECT statement, returning at most 200 rows.
   - `describe_table`: for one table, each column's meaning, distinct-value count, empty-value count and most common values, plus 5 sample rows.
   - `read_reference`: one topic file from `Web_code/knowledge/`.
   - `lookup_reject_codes`: the Volume 10 meaning of the given reject codes, from `Web_code/knowledge/reject_codes.json`.
     `Web_code/agent/agent.js` runs each tool call the model makes and returns the result to the model, until the model replies with text, for up to 12 rounds or 60 seconds. After that, one last request with tools switched off asks the model to answer from the results it has. The reply is streamed, so the page shows the answer as the model writes it, and the model's reasoning step is switched off. While the agent answers, a **Stop** button replaces the **Send** button. It cancels the request; text already written stays in the conversation, marked as stopped, and a prompt stopped before any text was written is not kept in the conversation.
4. `Web_code/agent/agent.js` replaces table names and column names with an underscore with plain words in the answer. If the answer contains an SQL query, it asks the model once to rewrite it in plain words, with tools switched off.
5. The page shows the answer text and a line saying how long it took, how many requests the model received, and after how many seconds the first words of the reply were shown; the tool calls and their SQL are not shown. When the first words are shown only at the end on one computer but early on another, a program on the slower computer, such as an antivirus program that scans web traffic, or a company proxy server, is holding back the streamed reply until it is complete.

### Speed and token use

A token is a piece of a word, about 4 characters; the model is charged and limited by the number of tokens sent and written.

- **Checking a client report.** `fact_message` has about 2.2 million rows, and a query that filters on its ID or CompID columns reads the whole table. `Web_code/reports/conformance.js` checks a whole report with three queries, however many test steps it has: one for every ID of every step across the five ID columns, one for the messages of the orders found, and one for the logon and mass cancel messages of every step that needs them. The rows returned are sorted into the steps with lookup tables keyed by step, order ID and client order ID, instead of filtering every row again for each step.
- **Repeated queries.** The tables do not change while the page is open, so the result of each retrieval query and each `run_sql` statement is kept by its SQL text. A follow-up question about the same CompID and months, or a statement the model already ran, uses the kept result without reading the tables again.
- **Small talk.** A greeting or thanks is sent with a short system prompt of about 500 characters and no tools, instead of the full instructions, reference and table columns.
- **Answers already in the results.** Questions about an attached report that its results answer are answered with no request to the model (step 4 of "Check a client's conformance test report").
- **Thinking.** When the model cannot switch off its reasoning step, the page shows "The language model is thinking" with the number of words of reasoning received so far, until the answer text starts.

The button at the top left of the chat area (a rectangle with a line down its left side) hides and shows the sidebar. The choice is kept in the browser, so it stays after a reload.

## Memory and the context bar

`Web_code/agent/memory.js` keeps the memory in the browser's own database (IndexedDB), on that computer only. Other computers and other analysts do not have it, and clearing the browser's site data for the page deletes it.

- **Conversations.** Every question, answer and attached report is saved as it happens. After a reload the page opens the last conversation again. The sidebar lists the saved conversations under **Conversations**: click one to open it, or × to delete it. Download links of reports written earlier are not saved; the Excel report and PDF report buttons write them again.
- **Memory notes.** Short facts sent with every question of every conversation, not shown on the page. To delete one, ask the agent to forget it. The model saves them with three tools:
  - `save_memory`: saves one note of at most 500 characters, when the analyst asks it to remember something, says how answers should be written, or the model reaches a finding a later conversation would need. At most 100 notes are kept.
  - `forget_memory`: deletes a note by its number.
  - `search_past_conversations`: finds earlier conversations that contain the words given, such as a CompID or test ID, and returns passages from up to 5 of them.
- **Context bar.** Above the question box: the tokens (pieces of words, about 4 characters each) that the request of the next question starts with, out of 64,000. It counts the system prompt, the memory notes, the tool definitions, the conversation so far and an attached report's results; the facts retrieved for the next question and its tool results come on top. The characters are converted to tokens with the ratio OpenRouter reported for the last request. The bar turns amber from 32,000 tokens and red from 64,000. The model accepts up to 1,000,000 tokens, but published tests found models answer less accurately long before their limit: in the NoLiMa test (Modarressi et al., 2025), 10 of 12 models scored less than half their short-request score at 32,000 tokens. The levels are `CONTEXT_WARN_TOKENS` and `CONTEXT_LIMIT_TOKENS` in `Web_code/agent/agent.js`.
- **Continue in a new conversation.** Shown when the bar is amber or red. One request with no tools asks the model for a summary of the conversation of at most 300 words; a new conversation starts with that summary and the attached report, and sends the summary with every question.

## Reference files: `Web_code/knowledge/`

Taken from JSE Volumes 00E, 01E, 10, 201 and 202 (the versions are listed at the top of `core.md`). Only `core.md` is sent with every question. `Web_code/agent/retrieve.js` adds up to 2 others to a question whose words match them, and the model can read any other with `read_reference`, so a question costs only the reference it uses.

| File                       | Contents                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.md`                | The agent's job, message types and tables, rules for reading the data (repeated rows, time zones, missing columns), how to investigate a failed test |
| `tests.md`               | Each conformance test: what the client does and what the messages must show; tests these exports cannot check                                        |
| `field_codes.md`         | Code values for every column                                                                                                                         |
| `reject_codes.md`        | Where reject codes appear; meaning of every code seen in the exports                                                                                 |
| `reject_codes.json`      | All 714 Volume 10 reject codes, for `lookup_reject_codes`                                                                                          |
| `trading_sessions.md`    | Segments, session times and what each session allows                                                                                                 |
| `orders.md`              | Order types, order states, amendment and matching rules                                                                                              |
| `identifiers.md`         | How the ID columns link messages                                                                                                                     |
| `gateway_rules.md`       | Logon, heartbeats, rate limit, cancel on disconnect, recovery, circuit breakers, self-match prevention                                               |
| `conformance_process.md` | Conformance rules, the Volume 202 report, exemptions                                                                                                 |
| `raw_data_dictionary.md` | Every field of the 11 raw datasets: its format in the export, its meaning, the months it appears in and how often it is filled |
| `client_report_template.md` | The layout of the report to the client: each sheet and column, and what goes in it. `Web_code/reports/client_report.js` writes the report; this file describes it |
| `agent_methodology.md` | How the agent answers a question and handles an attached report, in the same steps as `Pages/agent_methodology.html` |
| `problem_statement.md` | Group 6 problem statement |
| `project_brief.md` | JSE Academy final project brief |

To add a topic, add the file, an entry in `REFERENCE_TOPICS` in `Web_code/agent/agent.js`, and the words that select it in `TOPIC_WORDS` in `Web_code/agent/retrieve.js`. When the JSE publishes a new version of a volume, update the matching file here.

## Rebuild the Supabase data

The bucket `fix-data` holds the data in three layers, each made by a script from the layer before it, plus a copy of the scripts:

| Folder       | Made by            | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bronze/`  | `code/bronze.py` | The 36 Trading FIX message Excel exports in their month folders, unchanged except that every real CompID is replaced with its fictitious CompID from `CompID_Key.xlsx`. Supabase does not accept `[` or `]` in a file name, so they are stored as `(` and `)`; `bronze/files.json` lists the original names. `bronze/combined/` holds the same rows as one Parquet table per message type, all months combined, with the Excel headers as column names and every value as text, as it is written in the export. |
| `silver/`  | `code/silver.py` | `message.parquet`: one cleaned table with one row per message of every type (see "Silver table" below).                                                                                                                                                                                                                                                                                                                                                                                                |
| `gold/`    | `code/gold.py`   | The star schema the page loads (see below).                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `scripts/` | each script        | The current copy of the scripts in `code/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Run them in order when the Excel files change. They need Python and the packages in `code/requirements.txt` (`pip install -r code/requirements.txt`).

1. `python code/bronze.py` reads the Excel files in `DATA_DIR` and uploads them to `bronze/`. It stops without uploading a file if any real CompID is left in it. It then downloads them again and writes `bronze/combined/`, which takes about 10 minutes, most of it reading the Excel files. `python code/bronze.py --combine-only` does only the second step, from the Excel files already in the bucket.
2. `python code/silver.py` downloads `bronze/combined/` and uploads `silver/`.
3. `python code/gold.py` downloads `silver/` and uploads `gold/`.

Each script replaces the files in its folder and deletes files that it no longer writes. The Excel files and `CompID_Key.xlsx` are excluded from git.

## Settings: `code/.env`

`code/.env` is excluded from git by `code/.gitignore`. `code/.env.example` lists the same settings without the key.

| Setting                  | Meaning                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATA_DIR`             | Folder of month folders of Excel files, relative to the repository root. Default `Trading_FIX_Messages`.                                 |
| `SUPABASE_URL`         | Address of the Supabase project, `https://oftjypstiufmzblmtrom.supabase.co`.                                                             |
| `SUPABASE_SERVICE_KEY` | Supabase secret key. It can create buckets and upload files, so it is used only by the scripts in `code/` and never entered in the page. |
| `SUPABASE_BUCKET`      | Storage bucket name. Default `fix-data`.                                                                                                 |
| `COMPID_KEY`           | Excel file with columns `Real CompID` and `Fictitious CompID`, relative to the repository root. Default `CompID_Key.xlsx`.           |

## Gold tables

A star schema is a table of events (a fact table) whose code and ID columns are described in small lookup tables (dimension tables). `code/gold.py` describes each table and column in `gold/manifest.json`, which the agent's `list_tables` and `describe_table` tools return.

| Table                                                   | One row per                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `fact_message`                                        | Distinct message of every type (2,169,820 messages from 3,763,516 export rows)                        |
| `fact_order`                                          | Order (JSE `order_id`), with how it was entered, its outcome and counts of its reports and requests |
| `fact_compid_day`                                     | CompID per day, with counts of each kind of message                                                   |
| `dim_compid`, `dim_date`, `dim_security`          | CompID, calendar day, instrument                                                                      |
| `dim_message_type`, `dim_code`, `dim_reject_code` | Meaning of each message type, code value and reject code                                              |

`fact_message` is the silver table with these columns added:

- `is_rejection`: true for every message that rejects something the client sent: every Reject (`3`) and Order Cancel Reject (`9`), an execution report with `execution_type` or `order_status` 8, a mass cancel report with status 0, and a Logon Response with a `reject_code` other than 0 (logged in) and 3 (logged in, but the new password does not meet the password policy).
- A column ending in `_name` beside each code column, with the code's meaning from `dim_code` (`side_name` "Buy" beside `side` "1"), and `message_type_name` and `ref_message_type_name`. `fact_order` has the same for its code columns. Reject code meanings stay in `dim_reject_code`.
- `report_event`: what happened to the order in each execution report. It is taken from `execution_type` when that is filled (August and September); in July, where it is empty, it is worked out from `order_status`, `executed_quantity` and whether the report is the order's first.

## Silver table

Changes made in `silver/message.parquet`, compared with the bronze tables:

- Column names become lower case with underscores; spaces and tabs around values are removed; times and numbers are stored as times and numbers; ID and code columns stay text.
- Repeated rows are merged; `copies` counts the export rows in each message. An execution report is one row per `execution_id`; other messages one row per set of identical values.
- An empty `comp_id` on a JSE reply is filled from other messages of the same order (`comp_id_filled` is true).
- A New Order, cancel or amend with no `order_id` gets the `order_id` of the JSE reply with the same CompID and `client_order_id` captured within 1 second (`order_id_linked` is true).
- `-1`, the exports' "not set" value, becomes empty in `reject_code`, `minimum_quantity`, `stop_price` and `password_expiry`.
- The network capture columns (`source`, `destination`, `bytes`, `sequence_no`, `packet_id`) are left out; they are in `bronze/combined/`.

After loading, `Web_code/agent/data.js` switches off file, network and settings access for the SQL connection.
