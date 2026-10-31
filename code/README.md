# Trading Conformance Agent

A web chat page where a Trading Operations analyst asks questions about the Vonnegut FIX message exports, and a language model answers them by running SQL queries against those exports.

## Run it

```
pip install -r code/requirements.txt
python code/server.py
```

Open http://localhost:8000.

The first start reads all 36 Excel files and saves a Parquet copy of each in `code/.cache/` (Parquet is a compressed column-based file format that opens in under a second). This takes a few minutes. Later starts read only the Parquet copies, and re-read an Excel file only if its size or modified time has changed. To build the copies without starting the server, run `python code/data_store.py`.

## Settings: `code/.env`

| Setting | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key. `code/.env` is excluded from git by `code/.gitignore`. |
| `MODEL` | OpenRouter model name. Default `nvidia/nemotron-3-ultra-550b-a55b:free`. The model can also be changed in the page's sidebar per question. |
| `DATA_DIR` | Folder of month folders of Excel files, relative to the repository root. Default `Trading_Conformance/Trading_FIX_Message_Data/Raw_Data`. |
| `PORT` | Web server port. Default 8000. |

`code/.env.example` lists the same settings without the key.

## How a question is answered

1. `static/app.js` sends the whole conversation to `POST /api/chat` in `server.py`.
2. `agent.py` sends the conversation to OpenRouter with a system prompt describing conformance testing, the tables and the standard FIX code values, plus three tools the model may call:
   - `list_tables`: every table, its row count, columns and source Excel files.
   - `describe_table`: for one table, each column's distinct-value count, empty-value count and most common values, plus 5 sample rows.
   - `run_sql`: one read-only SELECT statement, returning at most 200 rows.
3. `agent.py` runs each tool call the model makes against `data_store.py` and returns the result to the model, up to 12 rounds, until the model replies with text.
4. The page shows the answer and, under it, each tool call with its SQL and result, so the analyst can check where every number came from.

## Tables

`data_store.py` combines the three months into one DuckDB table per FIX message type (DuckDB is an in-process SQL database). A file is assigned to a table by the most frequent value in its `Message Type` column, not by its file name, because some file names do not match their contents: `July_2026/Logout [B].xlsx` holds Logon Response messages.

| Table | FIX MsgType (tag 35) |
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
- The second `Message Type` column in Reject files is named `ref_message_type`: it holds the type of the message that was rejected (FIX tag 372).
- `Timestamp` and `Transact Time` are stored as date-times. Vonnegut writes a 24-hour time followed by "am" or "pm", which is removed.
- Quantities and prices are stored as numbers, with thousands commas removed. Identifiers and code columns stay as text.
- The view `all_messages` holds `table_name`, `source_month`, `source_file`, `timestamp`, `comp_id`, `message_type` and `client_order_id` for every row of every table, so one order or CompID can be followed across message types.

The SQL connection cannot read files, use the network or change settings, and `run_sql` rejects anything other than a single SELECT.
