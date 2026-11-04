-- Creates the three cleaning functions and silver.build_silver, which builds the silver layer: the 11 combined
-- bronze tables cleaned and put into one table, silver.message. Run it with: EXEC silver.build_silver;

USE TradingConformance;
GO

-- Cleaning functions, used on every column in step 1.
-- clean_text: removes spaces and tabs at both ends (NCHAR(9) is the tab character) and turns an empty value into NULL.
CREATE OR ALTER FUNCTION silver.clean_text (@value nvarchar(4000))
RETURNS nvarchar(4000)
WITH SCHEMABINDING
AS
BEGIN
    RETURN NULLIF(TRIM(CONCAT(N' ', NCHAR(9)) FROM @value), N'');
END;
GO

-- clean_number: clean_text, then removes the thousands commas. The caller converts the result to a number; a value
-- that is not a number stops the script with a conversion error.
CREATE OR ALTER FUNCTION silver.clean_number (@value nvarchar(4000))
RETURNS nvarchar(4000)
WITH SCHEMABINDING
AS
BEGIN
    RETURN REPLACE(silver.clean_text(@value), N',', N'');
END;
GO

-- clean_timestamp: Vonnegut writes a 24-hour time followed by a redundant "am" or "pm" ("2026-07-01 20:15:01.7941 pm");
-- the "am" or "pm" is removed. Transact Time has 9 decimal places of a second and datetime2 holds 7, so the text is
-- cut after the 7th. A value that is not a date and time becomes NULL.
CREATE OR ALTER FUNCTION silver.clean_timestamp (@value nvarchar(4000))
RETURNS datetime2(7)
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @text nvarchar(4000) = silver.clean_text(@value);
    IF @text LIKE N'% [ap]m'
        SET @text = RTRIM(LEFT(@text, LEN(@text) - 2));
    RETURN TRY_CONVERT(datetime2(7), LEFT(@text, 27), 121);
END;
GO

CREATE OR ALTER PROCEDURE silver.build_silver
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;   -- the first error stops the procedure

    -- Silver: the 11 combined bronze tables are cleaned and put into one table, silver.message, with one row per message.
    --
    -- 1. Cleaning (table silver.message_cleaned, one row per bronze row):
    --    - column names become lower case with underscores ("Client Order ID" becomes client_order_id), and some are
    --      renamed so that one name means the same thing in every message type (see the INSERT statements);
    --    - spaces and tabs around a value are removed, and a value left empty becomes NULL;
    --    - Timestamp and Transact Time become date-and-time values (datetime2);
    --    - quantities become whole numbers (bigint) and prices become decimal numbers (float), after the thousands
    --      commas are removed ("6,065.0000" becomes 6065);
    --    - identifier and code columns stay text, so leading zeros and letters are kept ("0000000000000302", "C");
    --    - the network capture columns (Source, Destination, Bytes, Sequence No, Packet ID) and the always-empty
    --      columns Expire Time and Segment are left out; they are still in bronze.
    -- 2. Repeated rows are merged. Vonnegut records many messages more than once. An execution report becomes one row per
    --    execution_id (copies of one report differ only in capture time and in whether comp_id is filled in), with the
    --    earliest capture time. Every other message type keeps one row per set of identical values, capture time
    --    included. copies is the number of bronze rows merged into the row.
    -- 3. "Not set" placeholders: -1 in reject_code, minimum_quantity, stop_price and password_expiry becomes NULL.
    -- 4. Missing CompIDs: some JSE replies have no comp_id. It is filled from other messages with the same order_id, then
    --    from messages with the same client_order_id, only where that ID belongs to one CompID. comp_id_filled marks
    --    the rows filled this way.
    -- 5. Order links: a New Order (D), Cancel (F) or Amend (G) request with no order_id is given the order_id of the
    --    first Execution Report (8) or Order Cancel Reject (9) with the same comp_id and client_order_id captured 0 to 1
    --    second after it. order_id_linked marks the rows linked this way.
    -- 6. message_id numbers the rows in order of comp_id, timestamp, message_type and execution_id.

    -- ---- 1. Cleaning ----
    DROP TABLE IF EXISTS silver.message_cleaned;
    CREATE TABLE silver.message_cleaned (
        [timestamp]                  datetime2(6),
        comp_id                      nvarchar(255),
        message_type                 nvarchar(255),
        ref_message_type             nvarchar(255),
        client_order_id              nvarchar(255),
        orig_client_order_id         nvarchar(255),
        order_id                     nvarchar(255),
        execution_id                 nvarchar(255),
        public_order_id              nvarchar(255),
        security_id                  nvarchar(255),
        side                         nvarchar(255),
        order_type                   nvarchar(255),
        order_sub_type               nvarchar(255),
        time_in_force                nvarchar(255),
        order_quantity               bigint,
        display_quantity             bigint,
        minimum_quantity             bigint,
        limit_price                  float,
        stop_price                   float,
        account                      nvarchar(255),
        capacity                     nvarchar(255),
        cancel_on_disconnect         nvarchar(255),
        execution_instruction        nvarchar(255),
        order_book                   nvarchar(255),
        self_trade_prevention_key    nvarchar(255),
        execution_type               nvarchar(255),
        order_status                 nvarchar(255),
        working_indicator            nvarchar(255),
        liquidity_indicator          nvarchar(255),
        type_of_trade                nvarchar(255),
        indicator_flags              nvarchar(255),
        leaves_quantity              bigint,
        executed_quantity            bigint,
        executed_price               float,
        transact_time                datetime2(7),
        reject_code                  nvarchar(255),
        reject_reason                nvarchar(255),
        partition_id                 nvarchar(255),
        mass_cancel_request_type     nvarchar(255),
        mass_cancel_status           nvarchar(255),
        logon_compid                 nvarchar(255),
        protocol_version             nvarchar(255),
        password_expiry              bigint,
        logout_reason                nvarchar(255),
        source_file                  nvarchar(400)
    );

    -- execution_report.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, display_quantity,
                                         execution_id, working_indicator, type_of_trade, transact_time, side,
                                         public_order_id, reject_code, order_id, leaves_quantity, liquidity_indicator,
                                         execution_type, execution_instruction, executed_quantity, executed_price,
                                         indicator_flags, order_book, order_status, security_id,
                                         self_trade_prevention_key, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           CONVERT(bigint, silver.clean_number([Display Quantity]))       AS display_quantity,
           silver.clean_text([Execution ID])                              AS execution_id,
           silver.clean_text([Working Indicator])                         AS working_indicator,
           silver.clean_text([TypeofTrade])                               AS type_of_trade,
           silver.clean_timestamp([Transact Time])                        AS transact_time,
           silver.clean_text([Side])                                      AS side,
           silver.clean_text([Public Order ID])                           AS public_order_id,
           silver.clean_text([Reject Code])                               AS reject_code,
           silver.clean_text([Order ID])                                  AS order_id,
           CONVERT(bigint, silver.clean_number([Leaves Quantity]))        AS leaves_quantity,
           silver.clean_text([Liquidity Indicator])                       AS liquidity_indicator,
           silver.clean_text([Execution Type])                            AS execution_type,
           silver.clean_text([Execution Instruction])                     AS execution_instruction,
           CONVERT(bigint, silver.clean_number([Executed Quantity]))      AS executed_quantity,
           CONVERT(float, silver.clean_number([Executed Price]))          AS executed_price,
           silver.clean_text([Indicator Flags])                           AS indicator_flags,
           silver.clean_text([Order Book])                                AS order_book,
           silver.clean_text([Order Status])                              AS order_status,
           silver.clean_text([Security ID])                               AS security_id,
           silver.clean_text([Self Trade Prevention Key])                 AS self_trade_prevention_key,
           source_file
    FROM bronze.execution_report;

    -- logon_response.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, password_expiry, reject_code, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           CONVERT(bigint, silver.clean_number([Password Expiry]))        AS password_expiry,
           silver.clean_text([Reject Code])                               AS reject_code,
           source_file
    FROM bronze.logon_response;

    -- logon.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, logon_compid, protocol_version, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([CompID])                                    AS logon_compid,
           silver.clean_text([Protocol Version])                          AS protocol_version,
           source_file
    FROM bronze.logon;

    -- logout.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, logout_reason, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Reason])                                    AS logout_reason,
           source_file
    FROM bronze.logout;

    -- new_order_single.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, account, cancel_on_disconnect,
                                         client_order_id, display_quantity, execution_instruction, limit_price,
                                         minimum_quantity, order_quantity, order_sub_type, order_type, security_id,
                                         self_trade_prevention_key, side, stop_price, time_in_force, capacity,
                                         order_book, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Account])                                   AS account,
           silver.clean_text([Cancel on Disconnect])                      AS cancel_on_disconnect,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           CONVERT(bigint, silver.clean_number([Display Quantity]))       AS display_quantity,
           silver.clean_text([Execution Instruction])                     AS execution_instruction,
           CONVERT(float, silver.clean_number([Limit Price]))             AS limit_price,
           CONVERT(bigint, silver.clean_number([Minimum Quantity]))       AS minimum_quantity,
           CONVERT(bigint, silver.clean_number([Order Quantity]))         AS order_quantity,
           silver.clean_text([Order Sub Type])                            AS order_sub_type,
           silver.clean_text([Order Type])                                AS order_type,
           silver.clean_text([Security ID])                               AS security_id,
           silver.clean_text([Self Trade Prevention Key])                 AS self_trade_prevention_key,
           silver.clean_text([Side])                                      AS side,
           CONVERT(float, silver.clean_number([Stop Price]))              AS stop_price,
           silver.clean_text([Time In Force])                             AS time_in_force,
           silver.clean_text([Capacity])                                  AS capacity,
           silver.clean_text([Order Book])                                AS order_book,
           source_file
    FROM bronze.new_order_single;

    -- order_cancel_reject. Left out: Source, Destination, Bytes, Sequence No, Packet ID.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, order_book, order_id,
                                         reject_code, transact_time, partition_id, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           silver.clean_text([Order Book])                                AS order_book,
           silver.clean_text([Order ID])                                  AS order_id,
           silver.clean_text([Reject Code])                               AS reject_code,
           silver.clean_timestamp([Transact Time])                        AS transact_time,
           silver.clean_text([Partition ID])                              AS partition_id,
           source_file
    FROM bronze.order_cancel_reject;

    -- order_cancel_replace_request. Left out: Expire Time.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, display_quantity,
                                         limit_price, minimum_quantity, order_id, orig_client_order_id, order_type,
                                         security_id, side, stop_price, time_in_force, order_quantity, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           CONVERT(bigint, silver.clean_number([Display Quantity]))       AS display_quantity,
           CONVERT(float, silver.clean_number([Limit Price]))             AS limit_price,
           CONVERT(bigint, silver.clean_number([Minimum Quantity]))       AS minimum_quantity,
           silver.clean_text([Order ID])                                  AS order_id,
           silver.clean_text([Original Client Order ID])                  AS orig_client_order_id,
           silver.clean_text([Order Type])                                AS order_type,
           silver.clean_text([Security ID])                               AS security_id,
           silver.clean_text([Side])                                      AS side,
           CONVERT(float, silver.clean_number([Stop Price]))              AS stop_price,
           silver.clean_text([Time In Force])                             AS time_in_force,
           CONVERT(bigint, silver.clean_number([Order Quantity]))         AS order_quantity,
           source_file
    FROM bronze.order_cancel_replace_request;

    -- order_cancel_request.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, order_book, order_id,
                                         orig_client_order_id, security_id, side, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           silver.clean_text([Order Book])                                AS order_book,
           silver.clean_text([Order ID])                                  AS order_id,
           silver.clean_text([Orig Client Order ID])                      AS orig_client_order_id,
           silver.clean_text([Security ID])                               AS security_id,
           silver.clean_text([Side])                                      AS side,
           source_file
    FROM bronze.order_cancel_request;

    -- order_mass_cancel_report.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, order_book, partition_id,
                                         reject_code, mass_cancel_status, transact_time, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           silver.clean_text([Order Book])                                AS order_book,
           silver.clean_text([Partition ID])                              AS partition_id,
           silver.clean_text([Reject Code])                               AS reject_code,
           silver.clean_text([Status])                                    AS mass_cancel_status,
           silver.clean_timestamp([Transact Time])                        AS transact_time,
           source_file
    FROM bronze.order_mass_cancel_report;

    -- order_mass_cancel_request. Left out: Segment.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, mass_cancel_request_type,
                                         security_id, order_sub_type, order_book, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           silver.clean_text([Mass Cancel Request Type])                  AS mass_cancel_request_type,
           silver.clean_text([Security ID])                               AS security_id,
           silver.clean_text([OrderSubType])                              AS order_sub_type,
           silver.clean_text([OrderBook])                                 AS order_book,
           source_file
    FROM bronze.order_mass_cancel_request;

    -- reject. Left out: Source, Destination, Bytes, Sequence No, Packet ID.
    INSERT INTO silver.message_cleaned ([timestamp], comp_id, message_type, client_order_id, ref_message_type,
                                         reject_code, reject_reason, source_file)
    SELECT silver.clean_timestamp([Timestamp])                            AS [timestamp],
           silver.clean_text([Comp ID])                                   AS comp_id,
           silver.clean_text([Message Type])                              AS message_type,
           silver.clean_text([Client Order ID])                           AS client_order_id,
           silver.clean_text([Message Type.1])                            AS ref_message_type,
           silver.clean_text([Reject Code])                               AS reject_code,
           silver.clean_text([Reject Reason])                             AS reject_reason,
           source_file
    FROM bronze.reject;

    -- Values that were filled in bronze but could not be read as a date and time. Expected: 0 for both.
    SELECT SUM(CASE WHEN [timestamp] IS NULL THEN 1 ELSE 0 END) AS unreadable_timestamps FROM silver.message_cleaned;
    SELECT (SELECT COUNT([Transact Time]) FROM bronze.execution_report) + (SELECT COUNT([Transact Time]) FROM bronze.order_cancel_reject)
         + (SELECT COUNT([Transact Time]) FROM bronze.order_mass_cancel_report) - COUNT(transact_time) AS unreadable_transact_times
    FROM silver.message_cleaned;

    -- ---- 2. Repeated rows merged ----
    -- #message is a temporary table: it is deleted when the procedure ends. comp_id_filled and order_id_linked are set
    -- to 1 in steps 4 and 5.
    DROP TABLE IF EXISTS #message;
    SELECT IDENTITY(bigint, 1, 1) AS row_no, merged.*, CAST(0 AS bit) AS comp_id_filled, CAST(0 AS bit) AS order_id_linked
    INTO #message
    FROM (
        -- Execution reports: one row per report, whatever its capture time and comp_id.
        SELECT MIN([timestamp]) AS [timestamp], MAX(comp_id) AS comp_id,
               message_type, ref_message_type, client_order_id, orig_client_order_id, order_id, execution_id,
               public_order_id, security_id, side, order_type, order_sub_type, time_in_force, order_quantity,
               display_quantity, minimum_quantity, limit_price, stop_price, account, capacity, cancel_on_disconnect,
               execution_instruction, order_book, self_trade_prevention_key, execution_type, order_status,
               working_indicator, liquidity_indicator, type_of_trade, indicator_flags, leaves_quantity,
               executed_quantity, executed_price, transact_time, reject_code, reject_reason, partition_id,
               mass_cancel_request_type, mass_cancel_status, logon_compid, protocol_version, password_expiry,
               logout_reason,
               COUNT(*) AS copies, MIN(source_file) AS source_file
        FROM silver.message_cleaned
        WHERE message_type = N'8'
        GROUP BY message_type, ref_message_type, client_order_id, orig_client_order_id, order_id, execution_id,
                 public_order_id, security_id, side, order_type, order_sub_type, time_in_force, order_quantity,
                 display_quantity, minimum_quantity, limit_price, stop_price, account, capacity, cancel_on_disconnect,
                 execution_instruction, order_book, self_trade_prevention_key, execution_type, order_status,
                 working_indicator, liquidity_indicator, type_of_trade, indicator_flags, leaves_quantity,
                 executed_quantity, executed_price, transact_time, reject_code, reject_reason, partition_id,
                 mass_cancel_request_type, mass_cancel_status, logon_compid, protocol_version, password_expiry,
                 logout_reason
        UNION ALL
        -- Every other message type: one row per set of identical values.
        SELECT [timestamp], comp_id, message_type, ref_message_type, client_order_id, orig_client_order_id, order_id,
               execution_id, public_order_id, security_id, side, order_type, order_sub_type, time_in_force,
               order_quantity, display_quantity, minimum_quantity, limit_price, stop_price, account, capacity,
               cancel_on_disconnect, execution_instruction, order_book, self_trade_prevention_key, execution_type,
               order_status, working_indicator, liquidity_indicator, type_of_trade, indicator_flags, leaves_quantity,
               executed_quantity, executed_price, transact_time, reject_code, reject_reason, partition_id,
               mass_cancel_request_type, mass_cancel_status, logon_compid, protocol_version, password_expiry,
               logout_reason,
               COUNT(*) AS copies, MIN(source_file) AS source_file
        FROM silver.message_cleaned
        WHERE message_type <> N'8'
        GROUP BY [timestamp], comp_id, message_type, ref_message_type, client_order_id, orig_client_order_id, order_id,
                 execution_id, public_order_id, security_id, side, order_type, order_sub_type, time_in_force,
                 order_quantity, display_quantity, minimum_quantity, limit_price, stop_price, account, capacity,
                 cancel_on_disconnect, execution_instruction, order_book, self_trade_prevention_key, execution_type,
                 order_status, working_indicator, liquidity_indicator, type_of_trade, indicator_flags, leaves_quantity,
                 executed_quantity, executed_price, transact_time, reject_code, reject_reason, partition_id,
                 mass_cancel_request_type, mass_cancel_status, logon_compid, protocol_version, password_expiry,
                 logout_reason
    ) merged;

    -- Two copies of one execution report must not differ in anything but capture time and comp_id.
    IF (SELECT COUNT(*) FROM #message WHERE message_type = N'8') <> (SELECT COUNT(DISTINCT execution_id) FROM #message WHERE message_type = N'8')
        THROW 50001, N'Execution reports sharing an execution_id differ in more than time and CompID', 1;

    -- ---- 3. "Not set" placeholders ----
    UPDATE #message
    SET reject_code = NULLIF(reject_code, N'-1'),
        minimum_quantity = NULLIF(minimum_quantity, -1),
        stop_price = NULLIF(stop_price, -1),
        password_expiry = NULLIF(password_expiry, -1);

    -- ---- 4. Missing CompIDs ----
    -- From another message with the same order_id. NONE is the order_id the JSE writes when it knows no order.
    UPDATE m
    SET comp_id = k.comp_id, comp_id_filled = 1
    FROM #message m
    JOIN (SELECT order_id, MAX(comp_id) AS comp_id
          FROM #message
          WHERE comp_id IS NOT NULL AND order_id IS NOT NULL AND order_id <> N'NONE'
          GROUP BY order_id
          HAVING COUNT(DISTINCT comp_id) = 1) k ON k.order_id = m.order_id
    WHERE m.comp_id IS NULL;

    -- Then from another message with the same client_order_id.
    UPDATE m
    SET comp_id = k.comp_id, comp_id_filled = 1
    FROM #message m
    JOIN (SELECT client_order_id, MAX(comp_id) AS comp_id
          FROM #message
          WHERE comp_id IS NOT NULL AND client_order_id IS NOT NULL AND client_order_id <> N'NONE'
          GROUP BY client_order_id
          HAVING COUNT(DISTINCT comp_id) = 1) k ON k.client_order_id = m.client_order_id
    WHERE m.comp_id IS NULL;

    -- ---- 5. Order links ----
    -- The index makes the search for each request's first reply fast.
    CREATE INDEX ix_reply ON #message (comp_id, client_order_id, [timestamp]) INCLUDE (message_type, order_id);

    UPDATE request
    SET order_id = reply.order_id, order_id_linked = 1
    FROM #message request
    CROSS APPLY (SELECT TOP (1) r.order_id, r.[timestamp]
                 FROM #message r
                 WHERE r.comp_id = request.comp_id
                   AND r.client_order_id = request.client_order_id
                   AND r.[timestamp] >= request.[timestamp]
                   AND r.message_type IN (N'8', N'9')
                   AND r.order_id IS NOT NULL AND r.order_id <> N'NONE'
                 ORDER BY r.[timestamp], r.order_id) reply
    WHERE request.message_type IN (N'D', N'F', N'G')
      AND request.order_id IS NULL
      AND request.comp_id IS NOT NULL
      AND reply.[timestamp] <= DATEADD(second, 1, request.[timestamp]);

    -- ---- 6. The silver table ----
    DROP TABLE IF EXISTS silver.message;
    SELECT ISNULL(CAST(ROW_NUMBER() OVER (ORDER BY CASE WHEN comp_id IS NULL THEN 1 ELSE 0 END, comp_id,
                                             CASE WHEN [timestamp] IS NULL THEN 1 ELSE 0 END, [timestamp], message_type,
                                             CASE WHEN execution_id IS NULL THEN 1 ELSE 0 END, execution_id) AS bigint), 0) AS message_id,
           [timestamp],
           CAST([timestamp] AS date) AS [date],
           comp_id,
           comp_id_filled,
           message_type,
           ref_message_type,
           client_order_id,
           orig_client_order_id,
           order_id,
           order_id_linked,
           execution_id,
           public_order_id,
           security_id,
           side,
           order_type,
           order_sub_type,
           time_in_force,
           order_quantity,
           display_quantity,
           minimum_quantity,
           limit_price,
           stop_price,
           account,
           capacity,
           cancel_on_disconnect,
           execution_instruction,
           order_book,
           self_trade_prevention_key,
           execution_type,
           order_status,
           working_indicator,
           liquidity_indicator,
           type_of_trade,
           indicator_flags,
           leaves_quantity,
           executed_quantity,
           executed_price,
           transact_time,
           reject_code,
           reject_reason,
           partition_id,
           mass_cancel_request_type,
           mass_cancel_status,
           logon_compid,
           protocol_version,
           password_expiry,
           logout_reason,
           copies,
           source_file
    INTO silver.message
    FROM #message;

    ALTER TABLE silver.message ADD CONSTRAINT pk_silver_message PRIMARY KEY (message_id);
    DROP TABLE #message;

    -- Rows per message type. The Python build of 01/11/2026 has: 3 736,608, 5 15,617, 8 245,298, 9 14,601, A 55,557, B 19,947, D 205,175, F 318,157, G 558,305, q 246, r 309.
    SELECT message_type, COUNT(*) AS messages FROM silver.message GROUP BY message_type ORDER BY message_type;
END;
GO
