-- Gold, step 2: gold.fact_message, one row per message of every type. It is silver.message with these columns added:
-- - is_rejection: 1 when the message rejects something the client sent. Every Reject (3) and Order Cancel Reject (9);
--   an Execution Report (8) with execution_type or order_status 8; an Order Mass Cancel Report (r) with status 0; a
--   Logon Response (B) with a reject_code other than 0 (logged in) and 3 (logged in, but the new password does not
--   meet the password policy). Every other message is 0.
-- - a column ending in _name beside each code column, holding the code's meaning from gold.dim_code (side_name "Buy"
--   beside side "1"), and message_type_name and ref_message_type_name from gold.dim_message_type. A code with no
--   meaning in the JSE list gets "Code not in the JSE list". Reject code meanings are in gold.dim_reject_code.
-- - report_event: what happened to the order in an execution report. execution_type gives it when filled (August
--   and September). July reports have only order_status, so it is worked out: a trade when executed_quantity is
--   above 0; for order_status 0 (New), "New (accepted)" on the order's first report and "Amended" on a later one;
--   "Amended or Restated" for order_status 1 without a trade; Cancelled, Expired, Rejected or Suspended for
--   order_status 4, 6, 8 and 9.

USE TradingConformance;
GO
SET NOCOUNT ON;

DROP TABLE IF EXISTS gold.fact_message;

WITH m AS (
    -- first_of_order is 1 on the first message of each type for each order_id, in order of capture time, then JSE
    -- event time (transact_time; an empty one counts as last), then execution_id.
    SELECT s.*,
           CASE WHEN ROW_NUMBER() OVER (PARTITION BY s.message_type, s.order_id
                                        ORDER BY s.[timestamp], CASE WHEN s.transact_time IS NULL THEN 1 ELSE 0 END,
                                                 s.transact_time, s.execution_id) = 1 THEN 1 ELSE 0 END AS first_of_order
    FROM silver.message s
)
SELECT m.message_id,
       m.[timestamp],
       m.[date],
       m.comp_id,
       m.comp_id_filled,
       m.message_type,
       t.message_name AS message_type_name,
       CAST(CASE m.message_type
                WHEN N'3' THEN 1
                WHEN N'9' THEN 1
                WHEN N'8' THEN CASE WHEN m.execution_type = N'8' OR m.order_status = N'8' THEN 1 ELSE 0 END
                WHEN N'r' THEN CASE WHEN m.mass_cancel_status = N'0' THEN 1 ELSE 0 END
                WHEN N'B' THEN CASE WHEN m.reject_code NOT IN (N'0', N'3') THEN 1 ELSE 0 END
                ELSE 0 END AS bit) AS is_rejection,
       m.ref_message_type,
       rt.message_name AS ref_message_type_name,
       m.client_order_id,
       m.orig_client_order_id,
       m.order_id,
       m.order_id_linked,
       m.execution_id,
       m.public_order_id,
       m.security_id,
       m.side,
       CASE WHEN m.side IS NULL THEN NULL ELSE COALESCE(c_side.meaning, N'Code not in the JSE list') END AS side_name,
       m.order_type,
       CASE WHEN m.order_type IS NULL THEN NULL ELSE COALESCE(c_order_type.meaning, N'Code not in the JSE list') END AS order_type_name,
       m.order_sub_type,
       CASE WHEN m.order_sub_type IS NULL THEN NULL ELSE COALESCE(c_order_sub_type.meaning, N'Code not in the JSE list') END AS order_sub_type_name,
       m.time_in_force,
       CASE WHEN m.time_in_force IS NULL THEN NULL ELSE COALESCE(c_time_in_force.meaning, N'Code not in the JSE list') END AS time_in_force_name,
       m.order_quantity,
       m.display_quantity,
       m.minimum_quantity,
       m.limit_price,
       m.stop_price,
       m.account,
       m.capacity,
       CASE WHEN m.capacity IS NULL THEN NULL ELSE COALESCE(c_capacity.meaning, N'Code not in the JSE list') END AS capacity_name,
       m.cancel_on_disconnect,
       CASE WHEN m.cancel_on_disconnect IS NULL THEN NULL ELSE COALESCE(c_cancel_on_disconnect.meaning, N'Code not in the JSE list') END AS cancel_on_disconnect_name,
       m.execution_instruction,
       CASE WHEN m.execution_instruction IS NULL THEN NULL ELSE COALESCE(c_execution_instruction.meaning, N'Code not in the JSE list') END AS execution_instruction_name,
       m.order_book,
       CASE WHEN m.order_book IS NULL THEN NULL ELSE COALESCE(c_order_book.meaning, N'Code not in the JSE list') END AS order_book_name,
       m.self_trade_prevention_key,
       m.execution_type,
       CASE WHEN m.execution_type IS NULL THEN NULL ELSE COALESCE(c_execution_type.meaning, N'Code not in the JSE list') END AS execution_type_name,
       m.order_status,
       CASE WHEN m.order_status IS NULL THEN NULL ELSE COALESCE(c_order_status.meaning, N'Code not in the JSE list') END AS order_status_name,
       CASE WHEN m.message_type <> N'8' THEN NULL
            WHEN m.execution_type IS NOT NULL THEN COALESCE(c_execution_type.meaning, N'Code not in the JSE list')
            WHEN m.executed_quantity > 0 THEN N'Trade'
            WHEN m.order_status = N'0' AND m.first_of_order = 1 THEN N'New (accepted)'
            WHEN m.order_status = N'0' THEN N'Amended'
            WHEN m.order_status = N'1' THEN N'Amended or Restated'
            WHEN m.order_status = N'4' THEN N'Cancelled'
            WHEN m.order_status = N'6' THEN N'Expired'
            WHEN m.order_status = N'8' THEN N'Rejected'
            WHEN m.order_status = N'9' THEN N'Suspended'
            END AS report_event,
       m.working_indicator,
       CASE WHEN m.working_indicator IS NULL THEN NULL ELSE COALESCE(c_working_indicator.meaning, N'Code not in the JSE list') END AS working_indicator_name,
       m.liquidity_indicator,
       CASE WHEN m.liquidity_indicator IS NULL THEN NULL ELSE COALESCE(c_liquidity_indicator.meaning, N'Code not in the JSE list') END AS liquidity_indicator_name,
       m.type_of_trade,
       CASE WHEN m.type_of_trade IS NULL THEN NULL ELSE COALESCE(c_type_of_trade.meaning, N'Code not in the JSE list') END AS type_of_trade_name,
       m.indicator_flags,
       CASE WHEN m.indicator_flags IS NULL THEN NULL ELSE COALESCE(c_indicator_flags.meaning, N'Code not in the JSE list') END AS indicator_flags_name,
       m.leaves_quantity,
       m.executed_quantity,
       m.executed_price,
       m.transact_time,
       m.reject_code,
       m.reject_reason,
       m.partition_id,
       m.mass_cancel_request_type,
       CASE WHEN m.mass_cancel_request_type IS NULL THEN NULL ELSE COALESCE(c_mass_cancel_request_type.meaning, N'Code not in the JSE list') END AS mass_cancel_request_type_name,
       m.mass_cancel_status,
       CASE WHEN m.mass_cancel_status IS NULL THEN NULL ELSE COALESCE(c_mass_cancel_status.meaning, N'Code not in the JSE list') END AS mass_cancel_status_name,
       m.logon_compid,
       m.protocol_version,
       CASE WHEN m.protocol_version IS NULL THEN NULL ELSE COALESCE(c_protocol_version.meaning, N'Code not in the JSE list') END AS protocol_version_name,
       m.password_expiry,
       m.logout_reason,
       m.copies,
       m.source_file
INTO gold.fact_message
FROM m
LEFT JOIN gold.dim_message_type t ON t.message_type = m.message_type
LEFT JOIN gold.dim_message_type rt ON rt.message_type = m.ref_message_type
LEFT JOIN gold.dim_code c_side ON c_side.column_name = N'side' AND c_side.code = m.side
LEFT JOIN gold.dim_code c_order_type ON c_order_type.column_name = N'order_type' AND c_order_type.code = m.order_type
LEFT JOIN gold.dim_code c_time_in_force ON c_time_in_force.column_name = N'time_in_force' AND c_time_in_force.code = m.time_in_force
LEFT JOIN gold.dim_code c_capacity ON c_capacity.column_name = N'capacity' AND c_capacity.code = m.capacity
LEFT JOIN gold.dim_code c_cancel_on_disconnect ON c_cancel_on_disconnect.column_name = N'cancel_on_disconnect' AND c_cancel_on_disconnect.code = m.cancel_on_disconnect
LEFT JOIN gold.dim_code c_execution_instruction ON c_execution_instruction.column_name = N'execution_instruction' AND c_execution_instruction.code = m.execution_instruction
LEFT JOIN gold.dim_code c_order_sub_type ON c_order_sub_type.column_name = N'order_sub_type' AND c_order_sub_type.code = m.order_sub_type
LEFT JOIN gold.dim_code c_order_book ON c_order_book.column_name = N'order_book' AND c_order_book.code = m.order_book
LEFT JOIN gold.dim_code c_execution_type ON c_execution_type.column_name = N'execution_type' AND c_execution_type.code = m.execution_type
LEFT JOIN gold.dim_code c_order_status ON c_order_status.column_name = N'order_status' AND c_order_status.code = m.order_status
LEFT JOIN gold.dim_code c_working_indicator ON c_working_indicator.column_name = N'working_indicator' AND c_working_indicator.code = m.working_indicator
LEFT JOIN gold.dim_code c_liquidity_indicator ON c_liquidity_indicator.column_name = N'liquidity_indicator' AND c_liquidity_indicator.code = m.liquidity_indicator
LEFT JOIN gold.dim_code c_type_of_trade ON c_type_of_trade.column_name = N'type_of_trade' AND c_type_of_trade.code = m.type_of_trade
LEFT JOIN gold.dim_code c_indicator_flags ON c_indicator_flags.column_name = N'indicator_flags' AND c_indicator_flags.code = m.indicator_flags
LEFT JOIN gold.dim_code c_mass_cancel_request_type ON c_mass_cancel_request_type.column_name = N'mass_cancel_request_type' AND c_mass_cancel_request_type.code = m.mass_cancel_request_type
LEFT JOIN gold.dim_code c_mass_cancel_status ON c_mass_cancel_status.column_name = N'mass_cancel_status' AND c_mass_cancel_status.code = m.mass_cancel_status
LEFT JOIN gold.dim_code c_protocol_version ON c_protocol_version.column_name = N'protocol_version' AND c_protocol_version.code = m.protocol_version;

ALTER TABLE gold.fact_message ALTER COLUMN message_id bigint NOT NULL;
GO
ALTER TABLE gold.fact_message ADD CONSTRAINT pk_fact_message PRIMARY KEY (message_id);
CREATE INDEX ix_fact_message_order ON gold.fact_message (order_id, message_type);
CREATE INDEX ix_fact_message_compid ON gold.fact_message (comp_id, [date]);
