-- Gold, step 3: gold.fact_order, one row per order, identified by the JSE order_id. It is built from the order's
-- execution reports, its New Order request (D) and the cancel (F) and amend (G) requests and cancel rejects (9) that
-- name the order.
--
-- "First" and "last" report mean first and last in order of capture time (timestamp), then JSE event time
-- (transact_time; an empty one counts as last), then execution_id. Where a column is empty on the last report,
-- last_execution_type, last_order_status and last_leaves_quantity take the last report on which it is filled
-- (July reports have no execution_type and August reports have no order_status).
-- FIRST_VALUE and LAST_VALUE with IGNORE NULLS take the first or last filled value in that order; they need
-- SQL Server 2022 or later.
--
-- outcome: Filled when a report has order_status 2 or the order traded and nothing is left open; otherwise
-- Cancelled, Expired or Rejected when a report says so (checked in that order); otherwise "Partly filled, no closing
-- report" or "Open, no closing report".

USE TradingConformance;
GO
SET NOCOUNT ON;

DROP TABLE IF EXISTS gold.fact_order;

WITH reports AS (
    SELECT order_id, comp_id, [timestamp], execution_type, order_status, reject_code, executed_quantity,
           FIRST_VALUE(client_order_id) IGNORE NULLS OVER report_order AS first_client_order_id,
           LAST_VALUE(leaves_quantity) IGNORE NULLS OVER report_order AS last_leaves_quantity,
           LAST_VALUE(execution_type) IGNORE NULLS OVER report_order AS last_execution_type,
           LAST_VALUE(order_status) IGNORE NULLS OVER report_order AS last_order_status
    FROM gold.fact_message
    WHERE message_type = N'8'
    WINDOW report_order AS (PARTITION BY order_id
                            ORDER BY [timestamp], CASE WHEN transact_time IS NULL THEN 1 ELSE 0 END, transact_time, execution_id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
),
orders AS (
    SELECT order_id,
           MAX(comp_id) AS comp_id,
           MIN([timestamp]) AS first_report_at,
           MAX([timestamp]) AS last_report_at,
           COUNT(*) AS execution_reports,
           MAX(first_client_order_id) AS first_client_order_id,
           MAX(CASE WHEN execution_type = N'8' OR order_status = N'8' THEN 1 ELSE 0 END) AS rejected,
           MAX(CASE WHEN execution_type = N'8' OR order_status = N'8' THEN reject_code END) AS reject_code,
           SUM(CASE WHEN executed_quantity > 0 THEN 1 ELSE 0 END) AS trades,
           COALESCE(SUM(executed_quantity), 0) AS executed_quantity,
           SUM(CASE WHEN execution_type = N'5' THEN 1 ELSE 0 END) AS amended_reports,
           MAX(CASE WHEN execution_type = N'4' OR order_status = N'4' THEN 1 ELSE 0 END) AS cancelled,
           MAX(CASE WHEN execution_type = N'C' OR order_status = N'6' THEN 1 ELSE 0 END) AS expired,
           MAX(CASE WHEN order_status = N'2' THEN 1 ELSE 0 END) AS filled_status,
           MAX(last_leaves_quantity) AS last_leaves_quantity,
           MAX(last_execution_type) AS last_execution_type,
           MAX(last_order_status) AS last_order_status
    FROM reports
    GROUP BY order_id
),
new_order_rows AS (
    -- Each column takes its value from the earliest New Order with that order_id on which it is filled.
    SELECT order_id, [timestamp],
           FIRST_VALUE(message_id) IGNORE NULLS OVER first_request AS new_order_message_id,
           FIRST_VALUE(security_id) IGNORE NULLS OVER first_request AS security_id,
           FIRST_VALUE(side) IGNORE NULLS OVER first_request AS side,
           FIRST_VALUE(order_type) IGNORE NULLS OVER first_request AS order_type,
           FIRST_VALUE(time_in_force) IGNORE NULLS OVER first_request AS time_in_force,
           FIRST_VALUE(order_quantity) IGNORE NULLS OVER first_request AS order_quantity,
           FIRST_VALUE(display_quantity) IGNORE NULLS OVER first_request AS display_quantity,
           FIRST_VALUE(limit_price) IGNORE NULLS OVER first_request AS limit_price
    FROM gold.fact_message
    WHERE message_type = N'D' AND order_id IS NOT NULL
    WINDOW first_request AS (PARTITION BY order_id ORDER BY [timestamp]
                             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
),
new_orders AS (
    SELECT order_id, MAX(new_order_message_id) AS new_order_message_id, MIN([timestamp]) AS new_order_at,
           MAX(security_id) AS security_id, MAX(side) AS side, MAX(order_type) AS order_type,
           MAX(time_in_force) AS time_in_force, MAX(order_quantity) AS order_quantity,
           MAX(display_quantity) AS display_quantity, MAX(limit_price) AS limit_price
    FROM new_order_rows
    GROUP BY order_id
),
requests AS (
    SELECT order_id,
           SUM(CASE WHEN message_type = N'G' THEN 1 ELSE 0 END) AS amend_requests,
           SUM(CASE WHEN message_type = N'F' THEN 1 ELSE 0 END) AS cancel_requests,
           SUM(CASE WHEN message_type = N'9' THEN 1 ELSE 0 END) AS cancel_rejects
    FROM gold.fact_message
    WHERE message_type IN (N'F', N'G', N'9') AND order_id IS NOT NULL
    GROUP BY order_id
),
f AS (
    SELECT o.order_id, o.comp_id, n.new_order_message_id, n.new_order_at, o.first_report_at, o.last_report_at,
           o.first_client_order_id, n.security_id, n.side, n.order_type, n.time_in_force, n.order_quantity,
           n.display_quantity, n.limit_price,
           CASE WHEN o.filled_status = 1 OR (o.trades > 0 AND o.last_leaves_quantity = 0) THEN N'Filled'
                WHEN o.cancelled = 1 THEN N'Cancelled'
                WHEN o.expired = 1 THEN N'Expired'
                WHEN o.rejected = 1 THEN N'Rejected'
                WHEN o.trades > 0 THEN N'Partly filled, no closing report'
                ELSE N'Open, no closing report' END AS outcome,
           o.reject_code, o.execution_reports, o.trades, o.executed_quantity, o.amended_reports,
           COALESCE(r.amend_requests, 0) AS amend_requests, COALESCE(r.cancel_requests, 0) AS cancel_requests,
           COALESCE(r.cancel_rejects, 0) AS cancel_rejects,
           o.last_execution_type, o.last_order_status, o.last_leaves_quantity
    FROM orders o
    LEFT JOIN new_orders n ON n.order_id = o.order_id
    LEFT JOIN requests r ON r.order_id = o.order_id
)
SELECT f.order_id,
       f.comp_id,
       f.new_order_message_id,
       f.new_order_at,
       f.first_report_at,
       f.last_report_at,
       f.first_client_order_id,
       f.security_id,
       f.side,
       CASE WHEN f.side IS NULL THEN NULL ELSE COALESCE(c_side.meaning, N'Code not in the JSE list') END AS side_name,
       f.order_type,
       CASE WHEN f.order_type IS NULL THEN NULL ELSE COALESCE(c_order_type.meaning, N'Code not in the JSE list') END AS order_type_name,
       f.time_in_force,
       CASE WHEN f.time_in_force IS NULL THEN NULL ELSE COALESCE(c_time_in_force.meaning, N'Code not in the JSE list') END AS time_in_force_name,
       f.order_quantity,
       f.display_quantity,
       f.limit_price,
       f.outcome,
       f.reject_code,
       f.execution_reports,
       f.trades,
       f.executed_quantity,
       f.amended_reports,
       f.amend_requests,
       f.cancel_requests,
       f.cancel_rejects,
       f.last_execution_type,
       CASE WHEN f.last_execution_type IS NULL THEN NULL ELSE COALESCE(c_last_execution_type.meaning, N'Code not in the JSE list') END AS last_execution_type_name,
       f.last_order_status,
       CASE WHEN f.last_order_status IS NULL THEN NULL ELSE COALESCE(c_last_order_status.meaning, N'Code not in the JSE list') END AS last_order_status_name,
       f.last_leaves_quantity
INTO gold.fact_order
FROM f
LEFT JOIN gold.dim_code c_side ON c_side.column_name = N'side' AND c_side.code = f.side
LEFT JOIN gold.dim_code c_order_type ON c_order_type.column_name = N'order_type' AND c_order_type.code = f.order_type
LEFT JOIN gold.dim_code c_time_in_force ON c_time_in_force.column_name = N'time_in_force' AND c_time_in_force.code = f.time_in_force
LEFT JOIN gold.dim_code c_last_execution_type ON c_last_execution_type.column_name = N'execution_type' AND c_last_execution_type.code = f.last_execution_type
LEFT JOIN gold.dim_code c_last_order_status ON c_last_order_status.column_name = N'order_status' AND c_last_order_status.code = f.last_order_status;

ALTER TABLE gold.fact_order ALTER COLUMN order_id nvarchar(255) NOT NULL;
GO
ALTER TABLE gold.fact_order ADD CONSTRAINT pk_fact_order PRIMARY KEY (order_id);
