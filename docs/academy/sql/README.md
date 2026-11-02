# Bronze, silver and gold in SQL Server

These scripts build the same tables as `code/bronze.py`, `code/silver.py` and `code/gold.py`, with the same rules, in a Microsoft SQL Server database named `TradingConformance`. Open each one in SQL Server Management Studio (SSMS) and run all of it, in this order:

| Script | What it does | Tables it writes |
|---|---|---|
| `00_create_database.sql` | Creates the database and the schemas `bronze`, `silver` and `gold` (a schema is a named group of tables), and allows SQL Server to read Excel files | — |
| `01_bronze_load_excel.sql` | Copies each Excel file, unchanged, into its own table | `bronze.excel_file` (the list of files), 36 `bronze.raw_...` tables |
| `02_bronze_combine.sql` | Combines the raw tables into one all-text table per message type | 11 tables, such as `bronze.execution_report` |
| `03_silver_message.sql` | Cleans the combined tables, merges repeated rows, fills missing CompIDs, links requests to orders | `silver.message_cleaned` (before merging), `silver.message` |
| `04_gold_reference_tables.sql` | Types in the meanings of message types, code values and Volume 10 reject codes | `gold.dim_message_type`, `gold.dim_code`, `gold.volume10_reject_reason` |
| `05_gold_fact_message.sql` | Adds `is_rejection`, the `_name` meaning columns and `report_event` | `gold.fact_message` |
| `06_gold_fact_order.sql` | One row per order | `gold.fact_order` |
| `07_gold_compid_day_and_dimensions.sql` | Counts per CompID and day, and the other dimension tables | `gold.fact_compid_day`, `gold.dim_compid`, `gold.dim_date`, `gold.dim_security`, `gold.dim_reject_code` |
| `08_check_counts.sql` | Compares row counts and other counts with the Python build of 01/11/2026 | — |

## Before running them

1. **SQL Server 2022 or later.** The Developer edition is free. The scripts use commands added in SQL Server 2022.
2. **Microsoft Access Database Engine 2016 Redistributable, 64-bit**, a free Microsoft download. It is the Excel reader that `01_bronze_load_excel.sql` uses. The copy that comes with Microsoft 365 cannot be used by SQL Server.
3. **The anonymised Excel files**: the 36 files in the `bronze/` folder of the storage bucket `fix-data`, kept in their three month folders (`July_2026`, `August_2026`, `September_2026`). Do not use the files in `Trading_FIX_Messages/`: they hold the real CompIDs.
4. Put the month folders in one folder, such as `C:\TradingData\bronze\`, and set `@folder` at the top of `01_bronze_load_excel.sql` to that folder. The SQL Server service account (by default `NT Service\MSSQLSERVER`) must be allowed to read it. If the load fails with "Cannot initialize the data source object of OLE DB provider", either that account cannot read the folder or the 64-bit Access Database Engine is not installed.

Table and column names are case-sensitive in this database: type them in lower case. The database compares text by exact characters, because JSE order IDs that differ only in upper and lower case are different orders.

## Where the results can differ from the Python build

- Where two rows have the same values in every column a step sorts by, each system picks one of them arbitrarily. This affects which `message_id` each such message gets, and which New Order supplies an order's details in `fact_order` when two New Orders for one order have the same capture time.
- Two cells in the second "Message Type" column of `August_2026/Reject 2.xlsx` hold only the character with code 0. The Excel reader returns them as empty, so their `ref_message_type` is empty here.

`08_check_counts.sql` shows whether the row counts and the counts of rejections, filled CompIDs, linked orders, outcomes and report events are the same as in the Python build.
