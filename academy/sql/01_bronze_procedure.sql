-- Creates bronze.build_bronze, which builds the bronze layer: step 1 copies each of the 36 Excel files into its own
-- raw table, unchanged; step 2 combines the raw tables into one all-text table per message type.
-- Run it with: EXEC bronze.build_bronze @folder = N'C:\TradingData\bronze\';

USE TradingConformance;
GO

CREATE OR ALTER PROCEDURE bronze.build_bronze
    @folder   nvarchar(400),
    @provider nvarchar(100) = N'Microsoft.ACE.OLEDB.16.0'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;   -- the first error stops the procedure

    -- Bronze, step 1: each of the 36 Excel files is copied into its own table, unchanged.
    --
    -- The Excel files are read by the Microsoft Access Database Engine (Microsoft.ACE.OLEDB.16.0), a free Microsoft
    -- add-on that lets SQL Server open Excel files. OPENROWSET is the SQL Server command that runs a query against a
    -- file through such an add-on. Every cell in these exports is stored by Excel as text, so every column of a raw
    -- table is text (nvarchar). The column names are the Excel headers. The reject files have two columns headed
    -- "Message Type"; the Excel reader names the second one "Message Type1".
    --
    -- @folder is the folder holding the three month folders (July_2026, August_2026, September_2026) of the anonymised
    -- Excel files, ending with a backslash.

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

    -- Bronze, step 2: the rows of the raw tables are combined into one table per message type, with every month's rows.
    --
    -- Nothing is changed in a value: every column stays text, exactly as Vonnegut wrote it ("6,065.0000", "-1",
    -- "2026-07-01 20:15:01.7941 pm"). The Excel reader returns some empty cells as NULL and others as empty text ('');
    -- NULLIF makes both NULL, as in the Python build. Two cells of "August_2026/Reject 2.xlsx" hold only the character
    -- with code 0, which the Excel reader returns as empty text, so they are NULL here and not in the Python build.
    --
    -- The columns are the Excel headers. Files of the same message type do not all have the same columns, so a combined
    -- table has every column found in any of its files, and a row from a file without that column has NULL there. The
    -- second "Message Type" column of the reject files ("Message Type1" in the raw tables) is named "Message Type.1".
    -- source_file names the Excel file each row came from.

    -- execution_report: 4 file(s), 699,162 rows
    DROP TABLE IF EXISTS bronze.execution_report;
    CREATE TABLE bronze.execution_report (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Display Quantity]             nvarchar(255),
        [Execution ID]                 nvarchar(255),
        [Working Indicator]            nvarchar(255),
        [TypeofTrade]                  nvarchar(255),
        [Transact Time]                nvarchar(255),
        [Side]                         nvarchar(255),
        [Public Order ID]              nvarchar(255),
        [Reject Code]                  nvarchar(255),
        [Order ID]                     nvarchar(255),
        [Leaves Quantity]              nvarchar(255),
        [Liquidity Indicator]          nvarchar(255),
        [Execution Type]               nvarchar(255),
        [Execution Instruction]        nvarchar(255),
        [Executed Quantity]            nvarchar(255),
        [Executed Price]               nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL,
        [Indicator Flags]              nvarchar(255),
        [Order Book]                   nvarchar(255),
        [Order Status]                 nvarchar(255),
        [Security ID]                  nvarchar(255),
        [Self Trade Prevention Key]    nvarchar(255)
    );
    INSERT INTO bronze.execution_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Display Quantity],
                                         [Execution ID], [Working Indicator], [TypeofTrade], [Transact Time], [Side],
                                         [Public Order ID], [Reject Code], [Order ID], [Leaves Quantity],
                                         [Liquidity Indicator], [Execution Type], [Execution Instruction],
                                         [Executed Quantity], [Executed Price], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Execution ID], N''), NULLIF([Working Indicator], N''),
           NULLIF([TypeofTrade], N''), NULLIF([Transact Time], N''), NULLIF([Side], N''), NULLIF([Public Order ID], N''),
           NULLIF([Reject Code], N''), NULLIF([Order ID], N''), NULLIF([Leaves Quantity], N''),
           NULLIF([Liquidity Indicator], N''), NULLIF([Execution Type], N''), NULLIF([Execution Instruction], N''),
           NULLIF([Executed Quantity], N''), NULLIF([Executed Price], N''), N'August_2026/Execution Report 1.xlsx'
    FROM bronze.raw_2026_08_execution_report_1;
    INSERT INTO bronze.execution_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Display Quantity],
                                         [Execution ID], [Working Indicator], [TypeofTrade], [Transact Time], [Side],
                                         [Public Order ID], [Reject Code], [Order ID], [Leaves Quantity],
                                         [Liquidity Indicator], [Execution Type], [Execution Instruction],
                                         [Executed Quantity], [Executed Price], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Execution ID], N''), NULLIF([Working Indicator], N''),
           NULLIF([TypeofTrade], N''), NULLIF([Transact Time], N''), NULLIF([Side], N''), NULLIF([Public Order ID], N''),
           NULLIF([Reject Code], N''), NULLIF([Order ID], N''), NULLIF([Leaves Quantity], N''),
           NULLIF([Liquidity Indicator], N''), NULLIF([Execution Type], N''), NULLIF([Execution Instruction], N''),
           NULLIF([Executed Quantity], N''), NULLIF([Executed Price], N''), N'August_2026/Execution Report 2.xlsx'
    FROM bronze.raw_2026_08_execution_report_2;
    INSERT INTO bronze.execution_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Display Quantity],
                                         [Executed Price], [Execution ID], [Executed Quantity], [Indicator Flags],
                                         [Leaves Quantity], [Liquidity Indicator], [Order Book], [Order Status],
                                         [Order ID], [Public Order ID], [Reject Code], [Security ID],
                                         [Self Trade Prevention Key], [Side], [Transact Time], [TypeofTrade],
                                         [Working Indicator], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Executed Price], N''), NULLIF([Execution ID], N''),
           NULLIF([Executed Quantity], N''), NULLIF([Indicator Flags], N''), NULLIF([Leaves Quantity], N''),
           NULLIF([Liquidity Indicator], N''), NULLIF([Order Book], N''), NULLIF([Order Status], N''),
           NULLIF([Order ID], N''), NULLIF([Public Order ID], N''), NULLIF([Reject Code], N''),
           NULLIF([Security ID], N''), NULLIF([Self Trade Prevention Key], N''), NULLIF([Side], N''),
           NULLIF([Transact Time], N''), NULLIF([TypeofTrade], N''), NULLIF([Working Indicator], N''),
           N'July_2026/Execution Report [8].xlsx'
    FROM bronze.raw_2026_07_execution_report_8;
    INSERT INTO bronze.execution_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Working Indicator],
                                         [TypeofTrade], [Order ID], [Order Status], [Execution Type],
                                         [Execution Instruction], [Execution ID], [Self Trade Prevention Key],
                                         [Executed Price], [Display Quantity], [Public Order ID], [Indicator Flags],
                                         [Executed Quantity], [Side], [Reject Code], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Working Indicator], N''), NULLIF([TypeofTrade], N''), NULLIF([Order ID], N''),
           NULLIF([Order Status], N''), NULLIF([Execution Type], N''), NULLIF([Execution Instruction], N''),
           NULLIF([Execution ID], N''), NULLIF([Self Trade Prevention Key], N''), NULLIF([Executed Price], N''),
           NULLIF([Display Quantity], N''), NULLIF([Public Order ID], N''), NULLIF([Indicator Flags], N''),
           NULLIF([Executed Quantity], N''), NULLIF([Side], N''), NULLIF([Reject Code], N''),
           N'September_2026/Execution Report.xlsx'
    FROM bronze.raw_2026_09_execution_report;

    -- logon_response: 3 file(s), 23,846 rows
    DROP TABLE IF EXISTS bronze.logon_response;
    CREATE TABLE bronze.logon_response (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Password Expiry]              nvarchar(255),
        [Reject Code]                  nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL
    );
    INSERT INTO bronze.logon_response ([Timestamp], [Comp ID], [Message Type], [Password Expiry], [Reject Code],
                                       [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Password Expiry], N''),
           NULLIF([Reject Code], N''), N'August_2026/Logon Response [B].xlsx'
    FROM bronze.raw_2026_08_logon_response_b;
    INSERT INTO bronze.logon_response ([Timestamp], [Comp ID], [Message Type], [Password Expiry], [Reject Code],
                                       [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Password Expiry], N''),
           NULLIF([Reject Code], N''), N'July_2026/Logout [B].xlsx'
    FROM bronze.raw_2026_07_logout_b;
    INSERT INTO bronze.logon_response ([Timestamp], [Comp ID], [Message Type], [Password Expiry], [Reject Code],
                                       [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Password Expiry], N''),
           NULLIF([Reject Code], N''), N'September_2026/Logon Response [B].xlsx'
    FROM bronze.raw_2026_09_logon_response_b;

    -- logon: 3 file(s), 74,580 rows
    DROP TABLE IF EXISTS bronze.logon;
    CREATE TABLE bronze.logon (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [CompID]                       nvarchar(255),
        [Protocol Version]             nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL
    );
    INSERT INTO bronze.logon ([Timestamp], [Comp ID], [Message Type], [CompID], [Protocol Version], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([CompID], N''),
           NULLIF([Protocol Version], N''), N'August_2026/Logon.xlsx'
    FROM bronze.raw_2026_08_logon;
    INSERT INTO bronze.logon ([Timestamp], [Comp ID], [Message Type], [CompID], [Protocol Version], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([CompID], N''),
           NULLIF([Protocol Version], N''), N'July_2026/Logon.xlsx'
    FROM bronze.raw_2026_07_logon;
    INSERT INTO bronze.logon ([Timestamp], [Comp ID], [Message Type], [CompID], [Protocol Version], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([CompID], N''),
           NULLIF([Protocol Version], N''), N'September_2026/Logon [A].xlsx'
    FROM bronze.raw_2026_09_logon_a;

    -- logout: 3 file(s), 21,306 rows
    DROP TABLE IF EXISTS bronze.logout;
    CREATE TABLE bronze.logout (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Reason]                       nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL
    );
    INSERT INTO bronze.logout ([Timestamp], [Comp ID], [Message Type], [Reason], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Reason], N''),
           N'August_2026/Logout.xlsx'
    FROM bronze.raw_2026_08_logout;
    INSERT INTO bronze.logout ([Timestamp], [Comp ID], [Message Type], [Reason], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Reason], N''),
           N'July_2026/Logout[5].xlsx'
    FROM bronze.raw_2026_07_logout_5;
    INSERT INTO bronze.logout ([Timestamp], [Comp ID], [Message Type], [Reason], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Reason], N''),
           N'September_2026/Logout.xlsx'
    FROM bronze.raw_2026_09_logout;

    -- new_order_single: 3 file(s), 325,344 rows
    DROP TABLE IF EXISTS bronze.new_order_single;
    CREATE TABLE bronze.new_order_single (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Account]                      nvarchar(255),
        [Cancel on Disconnect]         nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Display Quantity]             nvarchar(255),
        [Execution Instruction]        nvarchar(255),
        [Limit Price]                  nvarchar(255),
        [Minimum Quantity]             nvarchar(255),
        [Order Quantity]               nvarchar(255),
        [Order Sub Type]               nvarchar(255),
        [Order Type]                   nvarchar(255),
        [Security ID]                  nvarchar(255),
        [Self Trade Prevention Key]    nvarchar(255),
        [Side]                         nvarchar(255),
        [Stop Price]                   nvarchar(255),
        [Time In Force]                nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL,
        [Capacity]                     nvarchar(255),
        [Order Book]                   nvarchar(255)
    );
    INSERT INTO bronze.new_order_single ([Timestamp], [Comp ID], [Message Type], [Account], [Cancel on Disconnect],
                                         [Client Order ID], [Display Quantity], [Execution Instruction], [Limit Price],
                                         [Minimum Quantity], [Order Quantity], [Order Sub Type], [Order Type],
                                         [Security ID], [Self Trade Prevention Key], [Side], [Stop Price],
                                         [Time In Force], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Account], N''),
           NULLIF([Cancel on Disconnect], N''), NULLIF([Client Order ID], N''), NULLIF([Display Quantity], N''),
           NULLIF([Execution Instruction], N''), NULLIF([Limit Price], N''), NULLIF([Minimum Quantity], N''),
           NULLIF([Order Quantity], N''), NULLIF([Order Sub Type], N''), NULLIF([Order Type], N''),
           NULLIF([Security ID], N''), NULLIF([Self Trade Prevention Key], N''), NULLIF([Side], N''),
           NULLIF([Stop Price], N''), NULLIF([Time In Force], N''), N'August_2026/New Order [D].xlsx'
    FROM bronze.raw_2026_08_new_order_d;
    INSERT INTO bronze.new_order_single ([Timestamp], [Comp ID], [Message Type], [Cancel on Disconnect], [Capacity],
                                         [Client Order ID], [Display Quantity], [Execution Instruction], [Limit Price],
                                         [Minimum Quantity], [Order Quantity], [Order Sub Type], [Order Type],
                                         [Security ID], [Self Trade Prevention Key], [Side], [Stop Price],
                                         [Time In Force], [Order Book], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''),
           NULLIF([Cancel on Disconnect], N''), NULLIF([Capacity], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Execution Instruction], N''), NULLIF([Limit Price], N''),
           NULLIF([Minimum Quantity], N''), NULLIF([Order Quantity], N''), NULLIF([Order Sub Type], N''),
           NULLIF([Order Type], N''), NULLIF([Security ID], N''), NULLIF([Self Trade Prevention Key], N''),
           NULLIF([Side], N''), NULLIF([Stop Price], N''), NULLIF([Time In Force], N''), NULLIF([Order Book], N''),
           N'July_2026/New Order [D].xlsx'
    FROM bronze.raw_2026_07_new_order_d;
    INSERT INTO bronze.new_order_single ([Timestamp], [Comp ID], [Message Type], [Cancel on Disconnect], [Security ID],
                                         [Self Trade Prevention Key], [Execution Instruction], [Client Order ID],
                                         [Display Quantity], [Order Type], [Minimum Quantity], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''),
           NULLIF([Cancel on Disconnect], N''), NULLIF([Security ID], N''), NULLIF([Self Trade Prevention Key], N''),
           NULLIF([Execution Instruction], N''), NULLIF([Client Order ID], N''), NULLIF([Display Quantity], N''),
           NULLIF([Order Type], N''), NULLIF([Minimum Quantity], N''), N'September_2026/New Order.xlsx'
    FROM bronze.raw_2026_09_new_order;

    -- order_cancel_reject: 3 file(s), 21,909 rows
    DROP TABLE IF EXISTS bronze.order_cancel_reject;
    CREATE TABLE bronze.order_cancel_reject (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Order Book]                   nvarchar(255),
        [Order ID]                     nvarchar(255),
        [Reject Code]                  nvarchar(255),
        [Transact Time]                nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL,
        [Partition ID]                 nvarchar(255),
        [Source]                       nvarchar(255),
        [Destination]                  nvarchar(255),
        [Bytes]                        nvarchar(255),
        [Sequence No]                  nvarchar(255),
        [Packet ID]                    nvarchar(255)
    );
    INSERT INTO bronze.order_cancel_reject ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                            [Order ID], [Reject Code], [Transact Time], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Order ID], N''), NULLIF([Reject Code], N''), NULLIF([Transact Time], N''),
           N'August_2026/Order Cancel Reject[9].xlsx'
    FROM bronze.raw_2026_08_order_cancel_reject_9;
    INSERT INTO bronze.order_cancel_reject ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                            [Order ID], [Partition ID], [Reject Code], [Transact Time], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Order ID], N''), NULLIF([Partition ID], N''), NULLIF([Reject Code], N''),
           NULLIF([Transact Time], N''), N'July_2026/Order Cancel Reject.xlsx'
    FROM bronze.raw_2026_07_order_cancel_reject;
    INSERT INTO bronze.order_cancel_reject ([Timestamp], [Comp ID], [Message Type], [Source], [Destination], [Bytes],
                                            [Sequence No], [Packet ID], [Client Order ID], [Order Book], [Reject Code],
                                            [Transact Time], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Source], N''),
           NULLIF([Destination], N''), NULLIF([Bytes], N''), NULLIF([Sequence No], N''), NULLIF([Packet ID], N''),
           NULLIF([Client Order ID], N''), NULLIF([Order Book], N''), NULLIF([Reject Code], N''),
           NULLIF([Transact Time], N''), N'September_2026/Order Cancel Reject.xlsx'
    FROM bronze.raw_2026_09_order_cancel_reject;

    -- order_cancel_replace_request: 3 file(s), 929,951 rows
    DROP TABLE IF EXISTS bronze.order_cancel_replace_request;
    CREATE TABLE bronze.order_cancel_replace_request (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Display Quantity]             nvarchar(255),
        [Limit Price]                  nvarchar(255),
        [Minimum Quantity]             nvarchar(255),
        [Order ID]                     nvarchar(255),
        [Original Client Order ID]     nvarchar(255),
        [Order Type]                   nvarchar(255),
        [Security ID]                  nvarchar(255),
        [Side]                         nvarchar(255),
        [Stop Price]                   nvarchar(255),
        [Time In Force]                nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL,
        [Order Quantity]               nvarchar(255),
        [Expire Time]                  nvarchar(255)
    );
    INSERT INTO bronze.order_cancel_replace_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID],
                                                     [Display Quantity], [Limit Price], [Minimum Quantity], [Order ID],
                                                     [Original Client Order ID], [Order Type], [Security ID], [Side],
                                                     [Stop Price], [Time In Force], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Limit Price], N''), NULLIF([Minimum Quantity], N''),
           NULLIF([Order ID], N''), NULLIF([Original Client Order ID], N''), NULLIF([Order Type], N''),
           NULLIF([Security ID], N''), NULLIF([Side], N''), NULLIF([Stop Price], N''), NULLIF([Time In Force], N''),
           N'August_2026/Order Cancel Replace Request[G].xlsx'
    FROM bronze.raw_2026_08_order_cancel_replace_request_g;
    INSERT INTO bronze.order_cancel_replace_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID],
                                                     [Display Quantity], [Limit Price], [Minimum Quantity], [Order ID],
                                                     [Order Quantity], [Order Type], [Original Client Order ID],
                                                     [Time In Force], [Side], [Security ID], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Limit Price], N''), NULLIF([Minimum Quantity], N''),
           NULLIF([Order ID], N''), NULLIF([Order Quantity], N''), NULLIF([Order Type], N''),
           NULLIF([Original Client Order ID], N''), NULLIF([Time In Force], N''), NULLIF([Side], N''),
           NULLIF([Security ID], N''), N'July_2026/Order Cancel Replace Request [G].xlsx'
    FROM bronze.raw_2026_07_order_cancel_replace_request_g;
    INSERT INTO bronze.order_cancel_replace_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID],
                                                     [Display Quantity], [Expire Time], [Original Client Order ID],
                                                     [Minimum Quantity], [Time In Force], [Side], [Security ID],
                                                     [Order Type], [Limit Price], [Order ID], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Display Quantity], N''), NULLIF([Expire Time], N''), NULLIF([Original Client Order ID], N''),
           NULLIF([Minimum Quantity], N''), NULLIF([Time In Force], N''), NULLIF([Side], N''),
           NULLIF([Security ID], N''), NULLIF([Order Type], N''), NULLIF([Limit Price], N''), NULLIF([Order ID], N''),
           N'September_2026/Order Cancel Replace Request [G].xlsx'
    FROM bronze.raw_2026_09_order_cancel_replace_request_g;

    -- order_cancel_request: 3 file(s), 539,586 rows
    DROP TABLE IF EXISTS bronze.order_cancel_request;
    CREATE TABLE bronze.order_cancel_request (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Order Book]                   nvarchar(255),
        [Order ID]                     nvarchar(255),
        [Orig Client Order ID]         nvarchar(255),
        [Security ID]                  nvarchar(255),
        [Side]                         nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL
    );
    INSERT INTO bronze.order_cancel_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                             [Order ID], [Orig Client Order ID], [Security ID], [Side], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Order ID], N''), NULLIF([Orig Client Order ID], N''),
           NULLIF([Security ID], N''), NULLIF([Side], N''), N'August_2026/Order Cancel Request[F].xlsx'
    FROM bronze.raw_2026_08_order_cancel_request_f;
    INSERT INTO bronze.order_cancel_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                             [Order ID], [Orig Client Order ID], [Security ID], [Side], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Order ID], N''), NULLIF([Orig Client Order ID], N''),
           NULLIF([Security ID], N''), NULLIF([Side], N''), N'July_2026/Order Cancel Request[F].xlsx'
    FROM bronze.raw_2026_07_order_cancel_request_f;
    INSERT INTO bronze.order_cancel_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order ID],
                                             [Security ID], [Orig Client Order ID], [Side], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order ID], N''), NULLIF([Security ID], N''), NULLIF([Orig Client Order ID], N''), NULLIF([Side], N''),
           N'September_2026/Order Cancel Request [F].xlsx'
    FROM bronze.raw_2026_09_order_cancel_request_f;

    -- order_mass_cancel_report: 3 file(s), 464 rows
    DROP TABLE IF EXISTS bronze.order_mass_cancel_report;
    CREATE TABLE bronze.order_mass_cancel_report (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Order Book]                   nvarchar(255),
        [Partition ID]                 nvarchar(255),
        [Reject Code]                  nvarchar(255),
        [Status]                       nvarchar(255),
        [Transact Time]                nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL
    );
    INSERT INTO bronze.order_mass_cancel_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                                 [Partition ID], [Reject Code], [Status], [Transact Time], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Partition ID], N''), NULLIF([Reject Code], N''), NULLIF([Status], N''),
           NULLIF([Transact Time], N''), N'August_2026/Order Mass Cancel Report.xlsx'
    FROM bronze.raw_2026_08_order_mass_cancel_report;
    INSERT INTO bronze.order_mass_cancel_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                                 [Partition ID], [Reject Code], [Status], [Transact Time], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Partition ID], N''), NULLIF([Reject Code], N''), NULLIF([Status], N''),
           NULLIF([Transact Time], N''), N'July_2026/Order Mass Cancel Report.xlsx'
    FROM bronze.raw_2026_07_order_mass_cancel_report;
    INSERT INTO bronze.order_mass_cancel_report ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Order Book],
                                                 [Reject Code], [Status], [Transact Time], [Partition ID], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Order Book], N''), NULLIF([Reject Code], N''), NULLIF([Status], N''), NULLIF([Transact Time], N''),
           NULLIF([Partition ID], N''), N'September_2026/Order Mass Cancel Report [r].xlsx'
    FROM bronze.raw_2026_09_order_mass_cancel_report_r;

    -- order_mass_cancel_request: 3 file(s), 354 rows
    DROP TABLE IF EXISTS bronze.order_mass_cancel_request;
    CREATE TABLE bronze.order_mass_cancel_request (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Mass Cancel Request Type]     nvarchar(255),
        [Security ID]                  nvarchar(255),
        [OrderSubType]                 nvarchar(255),
        [Segment]                      nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL,
        [OrderBook]                    nvarchar(255)
    );
    INSERT INTO bronze.order_mass_cancel_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID],
                                                  [Mass Cancel Request Type], [Security ID], [OrderSubType], [Segment],
                                                  [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Mass Cancel Request Type], N''), NULLIF([Security ID], N''), NULLIF([OrderSubType], N''),
           NULLIF([Segment], N''), N'August_2026/Order Mass Cancel Request.xlsx'
    FROM bronze.raw_2026_08_order_mass_cancel_request;
    INSERT INTO bronze.order_mass_cancel_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID],
                                                  [Mass Cancel Request Type], [OrderBook], [OrderSubType], [Security ID],
                                                  [Segment], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Mass Cancel Request Type], N''), NULLIF([OrderBook], N''), NULLIF([OrderSubType], N''),
           NULLIF([Security ID], N''), NULLIF([Segment], N''), N'July_2026/Order Mass Cancel Request.xlsx'
    FROM bronze.raw_2026_07_order_mass_cancel_request;
    INSERT INTO bronze.order_mass_cancel_request ([Timestamp], [Comp ID], [Message Type], [Client Order ID],
                                                  [Mass Cancel Request Type], [OrderSubType], [Security ID], [Segment],
                                                  [OrderBook], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Mass Cancel Request Type], N''), NULLIF([OrderSubType], N''), NULLIF([Security ID], N''),
           NULLIF([Segment], N''), NULLIF([OrderBook], N''), N'September_2026/Order Mass Cancel Request [q].xlsx'
    FROM bronze.raw_2026_09_order_mass_cancel_request_q;

    -- reject: 5 file(s), 1,127,014 rows
    DROP TABLE IF EXISTS bronze.reject;
    CREATE TABLE bronze.reject (
        [Timestamp]                    nvarchar(255),
        [Comp ID]                      nvarchar(255),
        [Message Type]                 nvarchar(255),
        [Client Order ID]              nvarchar(255),
        [Message Type.1]               nvarchar(255),
        [Reject Code]                  nvarchar(255),
        [Reject Reason]                nvarchar(255),
        [source_file]                  nvarchar(400) NOT NULL,
        [Source]                       nvarchar(255),
        [Destination]                  nvarchar(255),
        [Bytes]                        nvarchar(255),
        [Sequence No]                  nvarchar(255),
        [Packet ID]                    nvarchar(255)
    );
    INSERT INTO bronze.reject ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Message Type.1],
                               [Reject Code], [Reject Reason], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Message Type1], N''), NULLIF([Reject Code], N''), NULLIF([Reject Reason], N''),
           N'August_2026/Reject 1.xlsx'
    FROM bronze.raw_2026_08_reject_1;
    INSERT INTO bronze.reject ([Timestamp], [Comp ID], [Message Type], [Source], [Destination], [Bytes], [Sequence No],
                               [Packet ID], [Client Order ID], [Message Type.1], [Reject Code], [Reject Reason],
                               [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Source], N''),
           NULLIF([Destination], N''), NULLIF([Bytes], N''), NULLIF([Sequence No], N''), NULLIF([Packet ID], N''),
           NULLIF([Client Order ID], N''), NULLIF([Message Type1], N''), NULLIF([Reject Code], N''),
           NULLIF([Reject Reason], N''), N'August_2026/Reject 2.xlsx'
    FROM bronze.raw_2026_08_reject_2;
    INSERT INTO bronze.reject ([Timestamp], [Comp ID], [Message Type], [Source], [Destination], [Bytes], [Sequence No],
                               [Packet ID], [Client Order ID], [Message Type.1], [Reject Code], [Reject Reason],
                               [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Source], N''),
           NULLIF([Destination], N''), NULLIF([Bytes], N''), NULLIF([Sequence No], N''), NULLIF([Packet ID], N''),
           NULLIF([Client Order ID], N''), NULLIF([Message Type1], N''), NULLIF([Reject Code], N''),
           NULLIF([Reject Reason], N''), N'August_2026/Reject 3.xlsx'
    FROM bronze.raw_2026_08_reject_3;
    INSERT INTO bronze.reject ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Message Type.1],
                               [Reject Code], [Reject Reason], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Message Type1], N''), NULLIF([Reject Code], N''), NULLIF([Reject Reason], N''),
           N'July_2026/Rejects.xlsx'
    FROM bronze.raw_2026_07_rejects;
    INSERT INTO bronze.reject ([Timestamp], [Comp ID], [Message Type], [Client Order ID], [Reject Reason], [Reject Code],
                               [Message Type.1], [source_file])
    SELECT NULLIF([Timestamp], N''), NULLIF([Comp ID], N''), NULLIF([Message Type], N''), NULLIF([Client Order ID], N''),
           NULLIF([Reject Reason], N''), NULLIF([Reject Code], N''), NULLIF([Message Type1], N''),
           N'September_2026/Reject.xlsx'
    FROM bronze.raw_2026_09_reject;

    -- Every combined table must hold the rows of its files, and every row's Message Type must be the table's type.
    SELECT combined_table, message_type, row_count, rows_of_another_type, expected_rows
    FROM (
    SELECT N'execution_report', N'8', COUNT(*), SUM(CASE WHEN [Message Type] = N'8' THEN 0 ELSE 1 END), 699162 FROM bronze.execution_report
    UNION ALL SELECT N'logon_response', N'B', COUNT(*), SUM(CASE WHEN [Message Type] = N'B' THEN 0 ELSE 1 END), 23846 FROM bronze.logon_response
    UNION ALL SELECT N'logon', N'A', COUNT(*), SUM(CASE WHEN [Message Type] = N'A' THEN 0 ELSE 1 END), 74580 FROM bronze.logon
    UNION ALL SELECT N'logout', N'5', COUNT(*), SUM(CASE WHEN [Message Type] = N'5' THEN 0 ELSE 1 END), 21306 FROM bronze.logout
    UNION ALL SELECT N'new_order_single', N'D', COUNT(*), SUM(CASE WHEN [Message Type] = N'D' THEN 0 ELSE 1 END), 325344 FROM bronze.new_order_single
    UNION ALL SELECT N'order_cancel_reject', N'9', COUNT(*), SUM(CASE WHEN [Message Type] = N'9' THEN 0 ELSE 1 END), 21909 FROM bronze.order_cancel_reject
    UNION ALL SELECT N'order_cancel_replace_request', N'G', COUNT(*), SUM(CASE WHEN [Message Type] = N'G' THEN 0 ELSE 1 END), 929951 FROM bronze.order_cancel_replace_request
    UNION ALL SELECT N'order_cancel_request', N'F', COUNT(*), SUM(CASE WHEN [Message Type] = N'F' THEN 0 ELSE 1 END), 539586 FROM bronze.order_cancel_request
    UNION ALL SELECT N'order_mass_cancel_report', N'r', COUNT(*), SUM(CASE WHEN [Message Type] = N'r' THEN 0 ELSE 1 END), 464 FROM bronze.order_mass_cancel_report
    UNION ALL SELECT N'order_mass_cancel_request', N'q', COUNT(*), SUM(CASE WHEN [Message Type] = N'q' THEN 0 ELSE 1 END), 354 FROM bronze.order_mass_cancel_request
    UNION ALL SELECT N'reject', N'3', COUNT(*), SUM(CASE WHEN [Message Type] = N'3' THEN 0 ELSE 1 END), 1127014 FROM bronze.reject
    ) c (combined_table, message_type, row_count, rows_of_another_type, expected_rows)
    ORDER BY combined_table;
END;
GO
