# Trading Conformance Agent

A web chat page where a JSE Trading Operations analyst asks questions about the Vonnegut message exports from conformance testing (July to September 2026), and a language model answers them by running SQL queries against those exports.

## Folders

| Path | Contents |
|---|---|
| `index.html` | The page. Stays in the root so GitHub Pages serves it as the site's home page. |
| `web/` | The page's code: `app.js` (chat screen), `agent.js` (language model and its tools), `data.js` (loads the data into the browser), `style.css` |
| `web/knowledge/` | The JSE conformance reference the agent reads (see below) |
| `code/` | Python scripts that build the bronze, silver and gold layers in Supabase |
| `docs/jse/` | The JSE specification documents the reference was taken from: Volumes 00E, 01E, 10, 201, 202 |
| `docs/academy/` | Academy project brief, Group 6 problem statement, and the diagram pages: `system_architecture.html`, `agent_methodology.html` (also as `agent_methodology.pdf`), `data_architecture.html`, `gold_star_schema.html`, `bronze_data_diagram.html` |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are; must stay in the root |

## Use the page

The page runs entirely in the browser and needs only a static web server, such as GitHub Pages. To run it on your own computer, run `python -m http.server` in the repository root and open http://localhost:8000.

Enter two keys in the sidebar. Neither is saved: paste them again after reloading the page.

| Key | Use |
|---|---|
| Supabase key | The Supabase publishable key (starts `sb_publishable_`). `web/data.js` uses it to download the message data from the private Supabase Storage bucket `fix-data`. Never enter the service key here. |
| OpenRouter key | `web/agent.js` sends it only to openrouter.ai, with each question. |

Every question is sent to the model `nvidia/nemotron-3.5-lightning:free`, set as `MODEL` in `web/agent.js`. The page has no setting to change it.

## How a question is answered

1. When the Supabase key is entered, `web/data.js` downloads `gold/manifest.json` and the gold Parquet tables from Supabase (Parquet is a compressed file format for tables), and loads them into DuckDB-WASM, the version of the DuckDB SQL database that runs in the browser.
2. `web/agent.js` sends the conversation to OpenRouter with a system prompt describing conformance testing and the tables, followed by `web/knowledge/core.md`, plus five tools the model may call:
   - `list_tables`: every table, its description, row count and columns with their meanings.
   - `describe_table`: for one table, each column's meaning, distinct-value count, empty-value count and most common values, plus 5 sample rows.
   - `run_sql`: one SELECT statement, returning at most 200 rows.
   - `read_reference`: one topic file from `web/knowledge/`.
   - `lookup_reject_codes`: the Volume 10 meaning of the given reject codes, from `web/knowledge/reject_codes.json`.
3. `web/agent.js` runs each tool call the model makes and returns the result to the model, up to 12 rounds, until the model replies with text.
4. The page shows the answer text only; the tool calls and their SQL are not shown.

## Reference files: `web/knowledge/`

Taken from the documents in `docs/jse/` and `docs/academy/`. Only `core.md` is sent with every question; the model reads the others when a question needs them, so a question costs only the reference it uses.

| File | Contents |
|---|---|
| `core.md` | The agent's job, message types and tables, rules for reading the data (repeated rows, time zones, missing columns), how to investigate a failed test |
| `tests.md` | Each conformance test: what the client does and what the messages must show; tests these exports cannot check |
| `field_codes.md` | Code values for every column |
| `reject_codes.md` | Where reject codes appear; meaning of every code seen in the exports |
| `reject_codes.json` | All 714 Volume 10 reject codes, for `lookup_reject_codes` |
| `trading_sessions.md` | Segments, session times and what each session allows |
| `orders.md` | Order types, order states, amendment and matching rules |
| `identifiers.md` | How the ID columns link messages |
| `gateway_rules.md` | Logon, heartbeats, rate limit, cancel on disconnect, recovery, circuit breakers, self-match prevention |
| `conformance_process.md` | Conformance rules, the Volume 202 report, exemptions |

To add a topic, add the file and an entry in `REFERENCE_TOPICS` in `web/agent.js`. When the JSE publishes a new version of a volume, replace it in `docs/jse/` and update the matching file here.

## Rebuild the Supabase data

The bucket `fix-data` holds the data in three layers, each made by a script from the layer before it, plus a copy of the scripts:

| Folder | Made by | Contents |
|---|---|---|
| `bronze/` | `code/bronze.py` | The 36 Vonnegut Excel exports in their month folders, unchanged except that every real CompID is replaced with its fictitious CompID from `CompID_Key.xlsx`. Supabase does not accept `[` or `]` in a file name, so they are stored as `(` and `)`; `bronze/files.json` lists the original names. `bronze/combined/` holds the same rows as one Parquet table per message type, all months combined, with the Excel headers as column names and every value as text, as Vonnegut wrote it. |
| `silver/` | `code/silver.py` | `message.parquet`: one cleaned table with one row per message of every type (see "Silver table" below). |
| `gold/` | `code/gold.py` | The star schema the page loads (see below). |
| `scripts/` | each script | The current copy of the scripts in `code/`. |

Run them in order when the Excel files change. They need Python and the packages in `code/requirements.txt` (`pip install -r code/requirements.txt`).

1. `python code/bronze.py` reads the Excel files in `DATA_DIR` and uploads them to `bronze/`. It stops without uploading a file if any real CompID is left in it. It then downloads them again and writes `bronze/combined/`, which takes about 10 minutes, most of it reading the Excel files. `python code/bronze.py --combine-only` does only the second step, from the Excel files already in the bucket.
2. `python code/silver.py` downloads `bronze/combined/` and uploads `silver/`.
3. `python code/gold.py` downloads `silver/` and uploads `gold/`.

Each script replaces the files in its folder and deletes files that it no longer writes. The Excel files and `CompID_Key.xlsx` are excluded from git.

## Settings: `code/.env`

`code/.env` is excluded from git by `code/.gitignore`. `code/.env.example` lists the same settings without the key.

| Setting | Meaning |
|---|---|
| `DATA_DIR` | Folder of month folders of Excel files, relative to the repository root. Default `Trading_FIX_Messages`. |
| `SUPABASE_URL` | Address of the Supabase project, `https://oftjypstiufmzblmtrom.supabase.co`. |
| `SUPABASE_SERVICE_KEY` | Supabase secret key. It can create buckets and upload files, so it is used only by the scripts in `code/` and never entered in the page. |
| `SUPABASE_BUCKET` | Storage bucket name. Default `fix-data`. |
| `COMPID_KEY` | Excel file with columns `Real CompID` and `Fictitious CompID`, relative to the repository root. Default `CompID_Key.xlsx`. |

## Gold tables

A star schema is a table of events (a fact table) whose code and ID columns are described in small lookup tables (dimension tables). `code/gold.py` describes each table and column in `gold/manifest.json`, which the agent's `list_tables` and `describe_table` tools return.

| Table | One row per |
|---|---|
| `fact_message` | Distinct message of every type (2,169,820 messages from 3,763,516 export rows) |
| `fact_order` | Order (JSE `order_id`), with how it was entered, its outcome and counts of its reports and requests |
| `fact_compid_day` | CompID per day, with counts of each kind of message |
| `dim_compid`, `dim_date`, `dim_security` | CompID, calendar day, instrument |
| `dim_message_type`, `dim_code`, `dim_reject_code` | Meaning of each message type, code value and reject code |

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

After loading, `web/data.js` switches off file, network and settings access for the SQL connection.
