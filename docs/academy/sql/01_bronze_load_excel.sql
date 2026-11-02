-- Bronze, step 1: each of the 36 Excel files is copied into its own table, unchanged.
--
-- The Excel files are read by the Microsoft Access Database Engine (Microsoft.ACE.OLEDB.16.0), a free Microsoft
-- add-on that lets SQL Server open Excel files. OPENROWSET is the SQL Server command that runs a query against a
-- file through such an add-on. Every cell in these exports is stored by Excel as text, so every column of a raw
-- table is text (nvarchar). The column names are the Excel headers. The reject files have two columns headed
-- "Message Type"; the Excel reader names the second one "Message Type1".
--
-- Before running: set @folder below to the folder holding the three month folders (July_2026, August_2026,
-- September_2026) of the anonymised Excel files, ending with a backslash.

USE TradingConformance;
GO
SET NOCOUNT ON;

DECLARE @folder nvarchar(400) = N'C:\TradingData\bronze\';
DECLARE @provider nvarchar(100) = N'Microsoft.ACE.OLEDB.16.0';

-- The 36 files: the path under @folder, the file name Vonnegut gave it (square brackets cannot be used in
-- the storage bucket, so the stored copies have round brackets), the raw table it is copied into, the combined
-- table its rows go to in step 2 (chosen from the file's Message Type column), and its number of data rows.
DROP TABLE IF EXISTS bronze.excel_file;
CREATE TABLE bronze.excel_file (
    file_path      nvarchar(400) NOT NULL,
    source_file    nvarchar(400) NOT NULL PRIMARY KEY,
    raw_table      sysname       NOT NULL,
    combined_table sysname       NOT NULL,
    expected_rows  int           NOT NULL,
    loaded_rows    int           NULL
);
INSERT INTO bronze.excel_file (file_path, source_file, raw_table, combined_table, expected_rows) VALUES
    (N'August_2026\Execution Report 1.xlsx', N'August_2026/Execution Report 1.xlsx', N'raw_2026_08_execution_report_1', N'execution_report', 270398),
    (N'August_2026\Execution Report 2.xlsx', N'August_2026/Execution Report 2.xlsx', N'raw_2026_08_execution_report_2', N'execution_report', 168418),
    (N'August_2026\Logon Response (B).xlsx', N'August_2026/Logon Response [B].xlsx', N'raw_2026_08_logon_response_b', N'logon_response', 9860),
    (N'August_2026\Logon.xlsx', N'August_2026/Logon.xlsx', N'raw_2026_08_logon', N'logon', 13205),
    (N'August_2026\Logout.xlsx', N'August_2026/Logout.xlsx', N'raw_2026_08_logout', N'logout', 11065),
    (N'August_2026\New Order (D).xlsx', N'August_2026/New Order [D].xlsx', N'raw_2026_08_new_order_d', N'new_order_single', 205986),
    (N'August_2026\Order Cancel Reject(9).xlsx', N'August_2026/Order Cancel Reject[9].xlsx', N'raw_2026_08_order_cancel_reject_9', N'order_cancel_reject', 11476),
    (N'August_2026\Order Cancel Replace Request(G).xlsx', N'August_2026/Order Cancel Replace Request[G].xlsx', N'raw_2026_08_order_cancel_replace_request_g', N'order_cancel_replace_request', 160352),
    (N'August_2026\Order Cancel Request(F).xlsx', N'August_2026/Order Cancel Request[F].xlsx', N'raw_2026_08_order_cancel_request_f', N'order_cancel_request', 124881),
    (N'August_2026\Order Mass Cancel Report.xlsx', N'August_2026/Order Mass Cancel Report.xlsx', N'raw_2026_08_order_mass_cancel_report', N'order_mass_cancel_report', 188),
    (N'August_2026\Order Mass Cancel Request.xlsx', N'August_2026/Order Mass Cancel Request.xlsx', N'raw_2026_08_order_mass_cancel_request', N'order_mass_cancel_request', 134),
    (N'August_2026\Reject 1.xlsx', N'August_2026/Reject 1.xlsx', N'raw_2026_08_reject_1', N'reject', 48628),
    (N'August_2026\Reject 2.xlsx', N'August_2026/Reject 2.xlsx', N'raw_2026_08_reject_2', N'reject', 88),
    (N'August_2026\Reject 3.xlsx', N'August_2026/Reject 3.xlsx', N'raw_2026_08_reject_3', N'reject', 983608),
    (N'July_2026\Execution Report (8).xlsx', N'July_2026/Execution Report [8].xlsx', N'raw_2026_07_execution_report_8', N'execution_report', 76466),
    (N'July_2026\Logon.xlsx', N'July_2026/Logon.xlsx', N'raw_2026_07_logon', N'logon', 44399),
    (N'July_2026\Logout (B).xlsx', N'July_2026/Logout [B].xlsx', N'raw_2026_07_logout_b', N'logon_response', 4312),
    (N'July_2026\Logout(5).xlsx', N'July_2026/Logout[5].xlsx', N'raw_2026_07_logout_5', N'logout', 4249),
    (N'July_2026\New Order (D).xlsx', N'July_2026/New Order [D].xlsx', N'raw_2026_07_new_order_d', N'new_order_single', 62040),
    (N'July_2026\Order Cancel Reject.xlsx', N'July_2026/Order Cancel Reject.xlsx', N'raw_2026_07_order_cancel_reject', N'order_cancel_reject', 8737),
    (N'July_2026\Order Cancel Replace Request (G).xlsx', N'July_2026/Order Cancel Replace Request [G].xlsx', N'raw_2026_07_order_cancel_replace_request_g', N'order_cancel_replace_request', 282791),
    (N'July_2026\Order Cancel Request(F).xlsx', N'July_2026/Order Cancel Request[F].xlsx', N'raw_2026_07_order_cancel_request_f', N'order_cancel_request', 274697),
    (N'July_2026\Order Mass Cancel Report.xlsx', N'July_2026/Order Mass Cancel Report.xlsx', N'raw_2026_07_order_mass_cancel_report', N'order_mass_cancel_report', 8),
    (N'July_2026\Order Mass Cancel Request.xlsx', N'July_2026/Order Mass Cancel Request.xlsx', N'raw_2026_07_order_mass_cancel_request', N'order_mass_cancel_request', 42),
    (N'July_2026\Rejects.xlsx', N'July_2026/Rejects.xlsx', N'raw_2026_07_rejects', N'reject', 126),
    (N'September_2026\Execution Report.xlsx', N'September_2026/Execution Report.xlsx', N'raw_2026_09_execution_report', N'execution_report', 183880),
    (N'September_2026\Logon Response (B).xlsx', N'September_2026/Logon Response [B].xlsx', N'raw_2026_09_logon_response_b', N'logon_response', 9674),
    (N'September_2026\Logon (A).xlsx', N'September_2026/Logon [A].xlsx', N'raw_2026_09_logon_a', N'logon', 16976),
    (N'September_2026\Logout.xlsx', N'September_2026/Logout.xlsx', N'raw_2026_09_logout', N'logout', 5992),
    (N'September_2026\New Order.xlsx', N'September_2026/New Order.xlsx', N'raw_2026_09_new_order', N'new_order_single', 57318),
    (N'September_2026\Order Cancel Reject.xlsx', N'September_2026/Order Cancel Reject.xlsx', N'raw_2026_09_order_cancel_reject', N'order_cancel_reject', 1696),
    (N'September_2026\Order Cancel Replace Request (G).xlsx', N'September_2026/Order Cancel Replace Request [G].xlsx', N'raw_2026_09_order_cancel_replace_request_g', N'order_cancel_replace_request', 486808),
    (N'September_2026\Order Cancel Request (F).xlsx', N'September_2026/Order Cancel Request [F].xlsx', N'raw_2026_09_order_cancel_request_f', N'order_cancel_request', 140008),
    (N'September_2026\Order Mass Cancel Report (r).xlsx', N'September_2026/Order Mass Cancel Report [r].xlsx', N'raw_2026_09_order_mass_cancel_report_r', N'order_mass_cancel_report', 268),
    (N'September_2026\Order Mass Cancel Request (q).xlsx', N'September_2026/Order Mass Cancel Request [q].xlsx', N'raw_2026_09_order_mass_cancel_request_q', N'order_mass_cancel_request', 178),
    (N'September_2026\Reject.xlsx', N'September_2026/Reject.xlsx', N'raw_2026_09_reject', N'reject', 94564);

-- Copy each file into its raw table. The table is dropped first, so the script can be run again.
DECLARE @path nvarchar(400), @table sysname, @sql nvarchar(max), @rows int;
DECLARE excel_files CURSOR LOCAL FAST_FORWARD FOR SELECT file_path, raw_table FROM bronze.excel_file ORDER BY source_file;
OPEN excel_files;
FETCH NEXT FROM excel_files INTO @path, @table;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DROP TABLE IF EXISTS bronze.' + QUOTENAME(@table) + N';
SELECT * INTO bronze.' + QUOTENAME(@table) + N'
FROM OPENROWSET(''' + @provider + N''',
                ''Excel 12.0 Xml;HDR=YES;IMEX=1;Database=' + REPLACE(@folder + @path, N'''', N'''''') + N''',
                ''SELECT * FROM [Vonnegut Export$]'');
SELECT @rows = COUNT(*) FROM bronze.' + QUOTENAME(@table) + N';';
    -- HDR=YES: the first row holds the column names. IMEX=1: a column with mixed values is read as text.
    EXEC sp_executesql @sql, N'@rows int OUTPUT', @rows = @rows OUTPUT;
    UPDATE bronze.excel_file SET loaded_rows = @rows WHERE raw_table = @table;
    PRINT CONCAT(@path, N': ', @rows, N' rows');
    FETCH NEXT FROM excel_files INTO @path, @table;
END;
CLOSE excel_files;
DEALLOCATE excel_files;

-- Every file must have loaded the number of rows it holds. This lists any file that did not.
SELECT source_file, expected_rows, loaded_rows
FROM bronze.excel_file
WHERE loaded_rows IS NULL OR loaded_rows <> expected_rows;
