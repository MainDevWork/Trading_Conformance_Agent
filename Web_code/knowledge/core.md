# JSE conformance reference: core

Sources: JSE Volume 00E – Trading and Information Overview for Equity Market v4.09 (28/05/2026); Volume 01E – Basic Native Trading Gateway v4.05 (28/05/2024); Volume 10 – JSE Reject Codes and Reasons v4.05 (12/08/2026); Volume 201 – Guide to JSE Trading and Information Conformance v3.08 (27/05/2024); Volume 202 – Conformance Test Report v3.08; the JSE Digital & Data Academy final project brief (07/10/2026); the Group 6 problem statement "Trading Conformance Automation and Reporting Framework". Facts marked "Observed in the data" come from the Vonnegut exports of July, August and September 2026, not from the JSE documents; their row counts include repeated rows.

## The job

JSE Trading Operations oversees conformance testing: before a client may trade on the JSE production market or receive production market data, it must show that its software exchanges messages with the JSE correctly. Every message a client sends and receives under a CompID during testing is captured in Vonnegut, the JSE message-capture platform. After testing, Trading Operations produces a conformance report of which test scenarios passed, and signs the client off for production.

The problems the agent must help with (Group 6 problem statement, sponsored by the Head of Trading Operations):

- When a conformance report is below a 100% pass rate, analysts investigate by hand to find the cause: they read the messages in Vonnegut, check the test scenario, check the conformance configuration and interpret the report.
- The report sometimes says a test failed when the messages show the client completed the scenario correctly. The agent must be able to show, from the messages, whether each scenario was actually completed.
- Analysts struggle to determine why a specific test failed, and the knowledge of how tests are set up is held by few people. The agent must explain failures in terms of the test steps and the message codes in these references.
- Visibility of conformance activity across clients is limited. The agent must be able to measure: number of clients (CompIDs) testing, pass and fail outcomes per test, turnaround time (first to last test message per client), repeat attempts, and activity by functionality and over time.

Rules from the Academy brief that apply to answers: use real data and say when a number is an estimate or comes from sample data; do not reveal client, supplier or staff names (identify clients only by CompID); state which numbers can be checked by hand and how; nothing the agent says is an instruction to change a production system.

## Which interface the messages come from

The exports are messages of the JSE **Basic Native Trading Gateway** (the JSE's own binary order-entry protocol for equities), not FIX. The message type letters show it: in the Native gateway `B` is Logon Response; in FIX `B` is News. Use the Native codes in these references. Do not use FIX tag numbers or FIX code meanings; several differ (the `field_codes` reference lists the differences).

| Code | Message | In `fact_message` | Sent by |
|---|---|---|---|
| A | Logon | yes | client |
| B | Logon Response | yes | JSE |
| 5 | Logout | yes | either |
| 0 | Heartbeat | not exported | either |
| 3 | Reject (message failed gateway validation) | yes | JSE |
| D | New Order | yes | client |
| F | Order Cancel Request | yes | client |
| G | Order Cancel/Replace Request (amend) | yes | client |
| q | Order Mass Cancel Request | yes | client |
| C | New Order Cross | not exported | client |
| 8 | Execution Report | yes | JSE |
| 9 | Order Cancel Reject | yes | JSE |
| r | Order Mass Cancel Report | yes | JSE |
| j | Business Reject | not exported | JSE |
| M, N, P | Missed Message Request, Missed Message Request Ack, Transmission Complete (recovery channel) | not exported (M appears only as `ref_message_type` of rejects) | client, JSE, JSE |
| n | System Status | not exported | JSE |
| Z | News | not exported | JSE |

## Rules for reading the data

- **Repeated rows.** Observed in the data: between 10% and 50% of rows in a Vonnegut export are copies of another row. `fact_message` already holds one row per message: an execution report is one row per `execution_id`, and other message types one row per set of identical values. `copies` is the number of export rows merged into the row. So `count(*)` on `fact_message` counts messages; say so when reporting a count.
- **Times.** `timestamp` is the Vonnegut capture time in South African time (SAST, UTC+2). `transact_time` is the JSE event time in UTC. Observed in the data: `transact_time` is 2 hours behind `timestamp`. Compare times with the session schedule (see the `trading_sessions` reference) in SAST, and say which column you used.
- **Missing columns.** Not every month has every column. Observed in the data: July execution reports have `order_status` but no `execution_type`; August execution reports have `execution_type` but no `order_status`; September has both. Check with `describe_table` before filtering on a column. `report_event` in `fact_message` says what happened in every execution report in every month: it is taken from `execution_type` when that is filled, and in July it is worked out from `order_status`, `executed_quantity` and whether the report is the order's first. `fact_order` handles this too: its `outcome` uses whichever of the two columns is filled.
- **Rejections.** `is_rejection` in `fact_message` is true for every message that rejects something the client sent. Use it to find or count rejections. `reject_code` alone is not enough: Logon Responses carry `reject_code` 0 (logged in) or 3 (logged in, but the new password does not meet the password policy), and neither is a rejection.
- **Code meanings.** Every code column in `fact_message` and `fact_order` has a column beside it ending in `_name` with the meaning of the code, for example `side_name` beside `side`. Reject code meanings are in `dim_reject_code`.
- **Placeholder values.** The exports write `-1` for "not set" in `reject_code`, `minimum_quantity`, `stop_price` and `password_expiry`; in `fact_message` these are empty (NULL). `NONE` in `order_id` of an Order Cancel Reject means the JSE could not find the order.
- **Filled and linked values.** Some JSE replies had no `comp_id`; `fact_message` fills it from other messages of the same order and marks those rows `comp_id_filled`. New Orders, cancels and amends that carried no `order_id` were given the `order_id` of the JSE reply with the same `comp_id` and `client_order_id` captured within 1 second, marked `order_id_linked`. Say so when an answer depends on a filled or linked value.
- **Reject codes** are stored without leading zeros (Volume 10 writes `001202`, the data `1202`).
- **Prices.** `executed_price`, `limit_price` and `stop_price` are in ZAC (South African cents) per share. Divide by 100 for Rand.
- **Comp ID.** `comp_id` (CompID, the Interface User ID) is the login name of one client connection. One firm (member) can have several CompIDs. Logon messages also have `logon_compid`, the CompID inside the Logon message.
- **Two message type columns in rejects.** For Reject messages, `message_type` is `3` and `ref_message_type` is the type of the client message that was rejected.
- **Security ID** is the JSE numeric Instrument ID. The exports do not contain instrument symbols or segments; the reference data that maps them (Volume 09, the daily reference data file) is not available here.

## How to investigate a failed or disputed test

1. Identify the CompID, the test date and the test ID. If the analyst gives only a CompID, read its rows in `fact_compid_day` to find the test days and what it sent on each.
2. List the client's messages for that day in time order from `fact_message`, and its orders from `fact_order`.
3. For each step of the test in the `tests` reference, find the client's request and the JSE's reply, linked by `order_id` or `client_order_id`, and check the session in force at that time (see the `trading_sessions` reference).
4. Look for rejections (`is_rejection` true) and explain each with the `reject_codes` reference: Reject `3` messages (`ref_message_type`, `reject_code`, `reject_reason`), execution reports with `execution_type` or `order_status` 8, Order Cancel Rejects, Mass Cancel Reports with `mass_cancel_status` 0, Logon Responses with a `reject_code` other than 0 and 3. Common causes in the data: price band (1202), wrong session (9008, 1524, 9015, 134007), unknown user or trader mnemonic (134200), order already gone (2000).
5. Check the process rules: a Logout or new Logon between steps that the test does not call for is a deviation; a missing step means the test was not completed; a step done in the wrong session (for example an IOC order during an auction) fails.
6. State the conclusion as: what the test requires, what the messages show (with the query used), and whether the messages support a pass or a fail. If the report says a scenario failed but the messages show every expected reply, say that the messages show the client completed it, and that the conformance configuration may need checking.
