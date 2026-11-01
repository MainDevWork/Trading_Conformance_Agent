# Trading Conformance Agent

A web chat page where a JSE Trading Operations analyst asks questions about the Vonnegut message exports from conformance testing (July to September 2026), and a language model answers them by running SQL queries against those exports.

## Folders

| Path | Contents |
|---|---|
| `index.html` | The page. Stays in the root so GitHub Pages serves it as the site's home page. |
| `web/` | The page's code: `app.js` (chat screen), `agent.js` (language model and its tools), `data.js` (loads the data into the browser), `style.css` |
| `web/knowledge/` | The JSE conformance reference the agent reads (see below) |
| `code/` | Python scripts that convert the Excel exports and upload them to Supabase |
| `docs/jse/` | The JSE specification documents the reference was taken from: Volumes 00E, 01E, 10, 201, 202 |
| `docs/academy/` | Academy project brief, Group 6 problem statement, system architecture diagram |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are; must stay in the root |

## Use the page

The page runs entirely in the browser and needs only a static web server, such as GitHub Pages. To run it on your own computer, run `python -m http.server` in the repository root and open http://localhost:8000.

Enter two keys in the sidebar. Neither is saved: paste them again after reloading the page.

| Key | Use |
|---|---|
| Supabase key | The Supabase publishable key (starts `sb_publishable_`). `web/data.js` uses it to download the message data from the private Supabase Storage bucket `fix-data`. Never enter the service key here. |
| OpenRouter key | `web/agent.js` sends it only to openrouter.ai, with each question. |

The sidebar's Model box sets the OpenRouter model. The default is `nvidia/nemotron-3.5-lightning:free`, set in `web/agent.js`.

## How a question is answered

1. When the Supabase key is entered, `web/data.js` downloads `manifest.json` and one Parquet file per table from Supabase (Parquet is a compressed file format for tables), and loads them into DuckDB-WASM, the version of the DuckDB SQL database that runs in the browser.
2. `web/agent.js` sends the conversation to OpenRouter with a system prompt describing conformance testing and the tables, followed by `web/knowledge/core.md`, plus five tools the model may call:
   - `list_tables`: every table, its row count, columns and source Excel files.
   - `describe_table`: for one table, each column's distinct-value count, empty-value count and most common values, plus 5 sample rows.
   - `run_sql`: one SELECT statement, returning at most 200 rows.
   - `read_reference`: one topic file from `web/knowledge/`.
   - `lookup_reject_codes`: the Volume 10 meaning of the given reject codes, from `web/knowledge/reject_codes.json`.
3. `web/agent.js` runs each tool call the model makes and returns the result to the model, up to 12 rounds, until the model replies with text.
4. The page shows the answer and, under it, each tool call with its SQL and result, so the analyst can check where every number came from.

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

Run these when the Excel files change. They need Python and the packages in `code/requirements.txt` (`pip install -r code/requirements.txt`).

1. `python code/build_site_data.py` reads the 36 Excel files in `DATA_DIR` and writes one Parquet file per table, plus `manifest.json`, to `data/`. The first run converts each Excel file to a Parquet copy in `code/.cache/`, which takes a few minutes. Later runs re-read an Excel file only if its size or modified time has changed.
2. `python code/upload_to_supabase.py` uploads everything in `data/` to the Supabase bucket, creating the bucket as private if it does not exist and replacing files of the same name.

`data/`, `code/.cache/` and the Excel files are excluded from git.

## Settings: `code/.env`

`code/.env` is excluded from git by `code/.gitignore`. `code/.env.example` lists the same settings without the key.

| Setting | Meaning |
|---|---|
| `DATA_DIR` | Folder of month folders of Excel files, relative to the repository root. Default `Trading_FIX_Messages`. |
| `SUPABASE_URL` | Address of the Supabase project, `https://oftjypstiufmzblmtrom.supabase.co`. |
| `SUPABASE_SERVICE_KEY` | Supabase secret key. It can create buckets and upload files, so it is used only by `upload_to_supabase.py` and never entered in the page. |
| `SUPABASE_BUCKET` | Storage bucket name. Default `fix-data`. |

## Tables

The exports are messages of the JSE Basic Native Trading Gateway. `code/data_store.py` combines the three months into one table per message type. A file is assigned to a table by the most frequent value in its `Message Type` column, not by its file name, because some file names do not match their contents: `July_2026/Logout [B].xlsx` holds Logon Response messages.

| Table | Native message type |
|---|---|
| `logon` | A |
| `logon_response` | B |
| `logout` | 5 |
| `new_order_single` | D |
| `order_cancel_request` | F |
| `order_cancel_replace_request` | G |
| `execution_report` | 8 |
| `order_cancel_reject` | 9 |
| `reject` | 3 |
| `order_mass_cancel_request` | q |
| `order_mass_cancel_report` | r |

Changes made while loading:

- Column headers are converted to lower case with underscores (`Comp ID` becomes `comp_id`).
- Every table gets `source_month` (for example `July_2026`) and `source_file`.
- The second `Message Type` column in Reject files is named `ref_message_type`: it holds the type of the message that was rejected.
- `Timestamp` and `Transact Time` are stored as date-times. Vonnegut writes a 24-hour time followed by "am" or "pm", which is removed.
- Quantities and prices are stored as numbers, with thousands commas removed. Identifiers and code columns stay as text.

In the browser, `web/data.js` also creates the view `all_messages`, which holds `table_name`, `source_month`, `source_file`, `timestamp`, `comp_id`, `message_type` and `client_order_id` for every row of every table, so one order or CompID can be followed across message types. After loading, `web/data.js` switches off file, network and settings access for the SQL connection.
