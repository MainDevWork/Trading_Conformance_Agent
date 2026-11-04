# Bronze, silver and gold in SQL Server

These scripts build the same tables as `code/bronze.py`, `code/silver.py` and `code/gold.py`, with the same rules, in a Microsoft SQL Server database named `TradingConformance`. Each layer is built by one stored procedure (a set of SQL statements saved in the database under a name and run with `EXEC`): `bronze.build_bronze`, `silver.build_silver` and `gold.build_gold`. Each procedure drops and rebuilds its layer's tables, so it can be run again.

Open each script in SQL Server Management Studio (SSMS) and run all of it, in this order. Scripts 01 to 03 only save the procedures; script 04 runs them.

| Script | What it does | Tables it writes |
|---|---|---|
| `00_create_database.sql` | Creates the database and the schemas `bronze`, `silver` and `gold` (a schema is a named group of tables), and allows SQL Server to read Excel files | — |
| `01_bronze_procedure.sql` | Saves `bronze.build_bronze @folder`. Step 1 copies each Excel file, unchanged, into its own table; step 2 combines them into one all-text table per message type | `bronze.excel_file` (the list of files), 36 `bronze.raw_...` tables, 11 combined tables such as `bronze.execution_report` |
| `02_silver_procedure.sql` | Saves the cleaning functions `silver.clean_text`, `silver.clean_number`, `silver.clean_timestamp`, and `silver.build_silver`, which cleans the combined tables, merges repeated rows, fills missing CompIDs and links requests to orders | `silver.message_cleaned` (before merging), `silver.message` |
| `03_gold_procedure.sql` | Saves `gold.build_gold`, which types in the meanings of message types, code values and Volume 10 reject codes, then builds the star schema | `gold.dim_message_type`, `gold.dim_code`, `gold.volume10_reject_reason`, `gold.fact_message`, `gold.fact_order`, `gold.fact_compid_day`, `gold.dim_compid`, `gold.dim_date`, `gold.dim_security`, `gold.dim_reject_code` |
| `04_run_all.sql` | Runs the three procedures in order | all of the above |
| `05_check_counts.sql` | Compares row counts and other counts with the Python build of 01/11/2026 | — |

A layer can be rebuilt on its own, for example `EXEC silver.build_silver;` after changing a cleaning rule; then run `EXEC gold.build_gold;` so gold is built from the new silver.

## Before running them

1. **SQL Server 2022 or later.** The Developer edition is free. The procedures use commands added in SQL Server 2022.
2. **Microsoft Access Database Engine 2016 Redistributable, 64-bit**, a free Microsoft download. It is the Excel reader that `bronze.build_bronze` uses. The copy that comes with Microsoft 365 cannot be used by SQL Server.
3. **The anonymised Excel files**: the 36 files in the `bronze/` folder of the storage bucket `fix-data`, kept in their three month folders (`July_2026`, `August_2026`, `September_2026`). Do not use the files in `Trading_FIX_Messages/`: they hold the real CompIDs.
4. Put the month folders in one folder, such as `C:\TradingData\bronze\`, and set `@folder` in `04_run_all.sql` to that folder. The SQL Server service account (by default `NT Service\MSSQLSERVER`) must be allowed to read it. If the load fails with "Cannot initialize the data source object of OLE DB provider", either that account cannot read the folder or the 64-bit Access Database Engine is not installed.

Table and column names are case-sensitive in this database: type them in lower case. The database compares text by exact characters, because JSE order IDs that differ only in upper and lower case are different orders.

## Where the results can differ from the Python build

- Where two rows have the same values in every column a step sorts by, each system picks one of them arbitrarily. This affects which `message_id` each such message gets, and which New Order supplies an order's details in `fact_order` when two New Orders for one order have the same capture time.
- Two cells in the second "Message Type" column of `August_2026/Reject 2.xlsx` hold only the character with code 0. The Excel reader returns them as empty, so their `ref_message_type` is empty here.

`05_check_counts.sql` shows whether the row counts and the counts of rejections, filled CompIDs, linked orders, outcomes and report events are the same as in the Python build.
