-- Gold, step 4: the last fact table and four dimension tables, all counted from gold.fact_message.
--   fact_compid_day  one row per CompID per day, counting each kind of message
--   dim_compid       one row per CompID: first and last message, days active, totals, Logon protocol versions
--   dim_date         one row per calendar day from the first to the last message
--   dim_security     one row per security_id (JSE numeric instrument ID)
--   dim_reject_code  the meaning of every reject_code in the messages, from JSE Volume 10, and the message types it
--                    was seen on

USE TradingConformance;
GO
SET NOCOUNT ON;
SET LANGUAGE us_english;   -- day and month names in English

-- ---- fact_compid_day ----
DROP TABLE IF EXISTS gold.fact_compid_day;
SELECT comp_id, [date],
       MIN([timestamp]) AS first_message_at,
       MAX([timestamp]) AS last_message_at,
       COUNT(*) AS messages,
       SUM(CASE WHEN message_type = N'A' THEN 1 ELSE 0 END) AS logons,
       SUM(CASE WHEN message_type = N'B' THEN 1 ELSE 0 END) AS logon_responses,
       SUM(CASE WHEN message_type = N'B' AND reject_code NOT IN (N'0', N'3') THEN 1 ELSE 0 END) AS logon_rejects,
       SUM(CASE WHEN message_type = N'5' THEN 1 ELSE 0 END) AS logouts,
       SUM(CASE WHEN message_type = N'D' THEN 1 ELSE 0 END) AS new_orders,
       SUM(CASE WHEN message_type = N'G' THEN 1 ELSE 0 END) AS amend_requests,
       SUM(CASE WHEN message_type = N'F' THEN 1 ELSE 0 END) AS cancel_requests,
       SUM(CASE WHEN message_type = N'q' THEN 1 ELSE 0 END) AS mass_cancel_requests,
       SUM(CASE WHEN message_type = N'8' THEN 1 ELSE 0 END) AS execution_reports,
       SUM(CASE WHEN message_type = N'8' AND executed_quantity > 0 THEN 1 ELSE 0 END) AS trades,
       SUM(CASE WHEN message_type = N'8' AND (execution_type = N'8' OR order_status = N'8') THEN 1 ELSE 0 END) AS order_rejects,
       SUM(CASE WHEN message_type = N'9' THEN 1 ELSE 0 END) AS cancel_rejects,
       SUM(CASE WHEN message_type = N'r' THEN 1 ELSE 0 END) AS mass_cancel_reports,
       SUM(CASE WHEN message_type = N'3' THEN 1 ELSE 0 END) AS gateway_rejects
INTO gold.fact_compid_day
FROM gold.fact_message
WHERE comp_id IS NOT NULL
GROUP BY comp_id, [date];

-- ---- dim_compid ----
DROP TABLE IF EXISTS gold.dim_compid;
WITH versions AS (
    SELECT comp_id, STRING_AGG(protocol_version, N', ') WITHIN GROUP (ORDER BY protocol_version) AS logon_protocol_versions
    FROM (SELECT DISTINCT comp_id, protocol_version FROM gold.fact_message
          WHERE comp_id IS NOT NULL AND protocol_version IS NOT NULL) v
    GROUP BY comp_id
)
SELECT f.comp_id,
       MIN(f.[timestamp]) AS first_message_at,
       MAX(f.[timestamp]) AS last_message_at,
       COUNT(DISTINCT f.[date]) AS active_days,
       COUNT(*) AS messages,
       SUM(CASE WHEN f.message_type = N'D' THEN 1 ELSE 0 END) AS new_orders,
       MAX(v.logon_protocol_versions) AS logon_protocol_versions
INTO gold.dim_compid
FROM gold.fact_message f
LEFT JOIN versions v ON v.comp_id = f.comp_id
WHERE f.comp_id IS NOT NULL
GROUP BY f.comp_id;

-- ---- dim_date ----
-- GENERATE_SERIES gives the numbers 0, 1, 2, ... up to the number of days between the first and last message.
DROP TABLE IF EXISTS gold.dim_date;
DECLARE @first date = (SELECT MIN([date]) FROM gold.fact_message);
DECLARE @last date = (SELECT MAX([date]) FROM gold.fact_message);
SELECT d.[date],
       DATENAME(weekday, d.[date]) AS day_name,
       DATENAME(month, d.[date]) + N'_' + DATENAME(year, d.[date]) AS [month],
       CAST(CASE WHEN DATENAME(weekday, d.[date]) IN (N'Saturday', N'Sunday') THEN 1 ELSE 0 END AS bit) AS is_weekend
INTO gold.dim_date
FROM (SELECT DATEADD(day, value, @first) AS [date] FROM GENERATE_SERIES(0, DATEDIFF(day, @first, @last))) d;

-- ---- dim_security ----
DROP TABLE IF EXISTS gold.dim_security;
SELECT security_id,
       MIN([timestamp]) AS first_message_at,
       MAX([timestamp]) AS last_message_at,
       COUNT(DISTINCT comp_id) AS compids,
       COUNT(*) AS messages
INTO gold.dim_security
FROM gold.fact_message
WHERE security_id IS NOT NULL
GROUP BY security_id;

-- ---- dim_reject_code ----
-- A code's meaning is its Volume 10 entries joined with " | ", each written as "reason (system)". The exports come
-- from the Native Trading Gateway, the Matching Engine, the AuthServer and the Exchange Manager, so when a code has
-- entries for one of these systems only those entries are used; otherwise all its entries are. Volume 10 writes
-- codes without leading zeros, so leading zeros are removed before the look-up. Code 0 and, on a Logon Response,
-- code 3 are not rejections, and their meanings say so.
DROP TABLE IF EXISTS gold.dim_reject_code;
WITH seen AS (
    SELECT reject_code,
           STRING_AGG(message_name, N', ') WITHIN GROUP (ORDER BY message_name) AS seen_on,
           CASE WHEN reject_code NOT LIKE N'%[^0]%' THEN N'0'
                ELSE SUBSTRING(reject_code, PATINDEX(N'%[^0]%', reject_code), 255) END AS volume10_code
    FROM (SELECT DISTINCT f.reject_code, t.message_name
          FROM gold.fact_message f
          JOIN gold.dim_message_type t ON t.message_type = f.message_type
          WHERE f.reject_code IS NOT NULL) d
    GROUP BY reject_code
),
entries AS (
    SELECT s.reject_code, v.entry_no, v.reason, v.[system],
           CASE WHEN REPLACE(v.[system], N' ', N'') LIKE N'%Native%'
                  OR REPLACE(v.[system], N' ', N'') LIKE N'%MatchingEngine%'
                  OR REPLACE(v.[system], N' ', N'') LIKE N'%AuthServer%'
                  OR REPLACE(v.[system], N' ', N'') LIKE N'%ExchangeManager%' THEN 1 ELSE 0 END AS is_export_system
    FROM seen s
    JOIN gold.volume10_reject_reason v ON v.code = s.volume10_code
),
meanings AS (
    SELECT reject_code,
           STRING_AGG(CAST(reason + N' (' + [system] + N')' AS nvarchar(max)), N' | ') WITHIN GROUP (ORDER BY entry_no) AS meaning
    FROM (SELECT *, MAX(is_export_system) OVER (PARTITION BY reject_code) AS code_has_export_system FROM entries) e
    WHERE is_export_system = 1 OR code_has_export_system = 0
    GROUP BY reject_code
)
SELECT s.reject_code,
       CASE WHEN s.reject_code = N'0' THEN N'Logon Response: logged in (no rejection)'
            WHEN s.reject_code = N'3' AND s.seen_on LIKE N'%Logon Response%'
                 THEN N'Logon Response: logged in, but the new password does not meet the password policy | '
                      + COALESCE(m.meaning, N'Not in Volume 10')
            ELSE COALESCE(m.meaning, N'Not in Volume 10') END AS meaning,
       s.seen_on
INTO gold.dim_reject_code
FROM seen s
LEFT JOIN meanings m ON m.reject_code = s.reject_code;
