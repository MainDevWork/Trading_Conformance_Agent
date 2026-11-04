-- Compares counts in the SQL Server tables with the same counts in the Python build of 01/11/2026 (code/bronze.py,
-- code/silver.py, code/gold.py). matches is 1 when the two are equal.

USE TradingConformance;
GO

SELECT layer, table_name, counted, sql_server, python_build, CASE WHEN sql_server = python_build THEN 1 ELSE 0 END AS matches
FROM (
SELECT N'bronze', N'execution_report', N'rows', (SELECT COUNT(*) FROM bronze.execution_report), 699162
UNION ALL SELECT N'bronze', N'logon_response', N'rows', (SELECT COUNT(*) FROM bronze.logon_response), 23846
UNION ALL SELECT N'bronze', N'logon', N'rows', (SELECT COUNT(*) FROM bronze.logon), 74580
UNION ALL SELECT N'bronze', N'logout', N'rows', (SELECT COUNT(*) FROM bronze.logout), 21306
UNION ALL SELECT N'bronze', N'new_order_single', N'rows', (SELECT COUNT(*) FROM bronze.new_order_single), 325344
UNION ALL SELECT N'bronze', N'order_cancel_reject', N'rows', (SELECT COUNT(*) FROM bronze.order_cancel_reject), 21909
UNION ALL SELECT N'bronze', N'order_cancel_replace_request', N'rows', (SELECT COUNT(*) FROM bronze.order_cancel_replace_request), 929951
UNION ALL SELECT N'bronze', N'order_cancel_request', N'rows', (SELECT COUNT(*) FROM bronze.order_cancel_request), 539586
UNION ALL SELECT N'bronze', N'order_mass_cancel_report', N'rows', (SELECT COUNT(*) FROM bronze.order_mass_cancel_report), 464
UNION ALL SELECT N'bronze', N'order_mass_cancel_request', N'rows', (SELECT COUNT(*) FROM bronze.order_mass_cancel_request), 354
UNION ALL SELECT N'bronze', N'reject', N'rows', (SELECT COUNT(*) FROM bronze.reject), 1127014
UNION ALL SELECT N'silver', N'message', N'rows', (SELECT COUNT(*) FROM silver.message), 2169820
UNION ALL SELECT N'silver', N'message', N'message_type 3', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'3'), 736608
UNION ALL SELECT N'silver', N'message', N'message_type 5', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'5'), 15617
UNION ALL SELECT N'silver', N'message', N'message_type 8', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'8'), 245298
UNION ALL SELECT N'silver', N'message', N'message_type 9', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'9'), 14601
UNION ALL SELECT N'silver', N'message', N'message_type A', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'A'), 55557
UNION ALL SELECT N'silver', N'message', N'message_type B', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'B'), 19947
UNION ALL SELECT N'silver', N'message', N'message_type D', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'D'), 205175
UNION ALL SELECT N'silver', N'message', N'message_type F', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'F'), 318157
UNION ALL SELECT N'silver', N'message', N'message_type G', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'G'), 558305
UNION ALL SELECT N'silver', N'message', N'message_type q', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'q'), 246
UNION ALL SELECT N'silver', N'message', N'message_type r', (SELECT COUNT(*) FROM silver.message WHERE message_type = N'r'), 309
UNION ALL SELECT N'silver', N'message', N'comp_id_filled = 1', (SELECT COUNT(*) FROM silver.message WHERE comp_id_filled = 1), 5611
UNION ALL SELECT N'silver', N'message', N'order_id_linked = 1', (SELECT COUNT(*) FROM silver.message WHERE order_id_linked = 1), 232316
UNION ALL SELECT N'gold', N'fact_message', N'rows', (SELECT COUNT(*) FROM gold.fact_message), 2169820
UNION ALL SELECT N'gold', N'fact_order', N'rows', (SELECT COUNT(*) FROM gold.fact_order), 162605
UNION ALL SELECT N'gold', N'fact_compid_day', N'rows', (SELECT COUNT(*) FROM gold.fact_compid_day), 2217
UNION ALL SELECT N'gold', N'dim_compid', N'rows', (SELECT COUNT(*) FROM gold.dim_compid), 52
UNION ALL SELECT N'gold', N'dim_date', N'rows', (SELECT COUNT(*) FROM gold.dim_date), 92
UNION ALL SELECT N'gold', N'dim_security', N'rows', (SELECT COUNT(*) FROM gold.dim_security), 246
UNION ALL SELECT N'gold', N'dim_message_type', N'rows', (SELECT COUNT(*) FROM gold.dim_message_type), 11
UNION ALL SELECT N'gold', N'dim_code', N'rows', (SELECT COUNT(*) FROM gold.dim_code), 74
UNION ALL SELECT N'gold', N'dim_reject_code', N'rows', (SELECT COUNT(*) FROM gold.dim_reject_code), 37
UNION ALL SELECT N'gold', N'fact_message', N'is_rejection = 1', (SELECT COUNT(*) FROM gold.fact_message WHERE is_rejection = 1), 845307
UNION ALL SELECT N'gold', N'fact_order', N'outcome Rejected', (SELECT COUNT(*) FROM gold.fact_order WHERE outcome = N'Rejected'), 86910
UNION ALL SELECT N'gold', N'fact_order', N'outcome Cancelled', (SELECT COUNT(*) FROM gold.fact_order WHERE outcome = N'Cancelled'), 56599
UNION ALL SELECT N'gold', N'fact_order', N'outcome Expired', (SELECT COUNT(*) FROM gold.fact_order WHERE outcome = N'Expired'), 11098
UNION ALL SELECT N'gold', N'fact_order', N'outcome Filled', (SELECT COUNT(*) FROM gold.fact_order WHERE outcome = N'Filled'), 7851
UNION ALL SELECT N'gold', N'fact_message', N'report_event Rejected', (SELECT COUNT(*) FROM gold.fact_message WHERE report_event = N'Rejected'), 86910
UNION ALL SELECT N'gold', N'fact_message', N'report_event New (accepted)', (SELECT COUNT(*) FROM gold.fact_message WHERE report_event = N'New (accepted)'), 66677
UNION ALL SELECT N'gold', N'fact_message', N'report_event Cancelled', (SELECT COUNT(*) FROM gold.fact_message WHERE report_event = N'Cancelled'), 57144
UNION ALL SELECT N'gold', N'fact_message', N'report_event Trade', (SELECT COUNT(*) FROM gold.fact_message WHERE report_event = N'Trade'), 11886
) c (layer, table_name, counted, sql_server, python_build);
