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

| Code | Message | Table | Sent by |
|---|---|---|---|
| A | Logon | `logon` | client |
| B | Logon Response | `logon_response` | JSE |
| 5 | Logout | `logout` | either |
| 0 | Heartbeat | not exported | either |
| 3 | Reject (message failed gateway validation) | `reject` | JSE |
| D | New Order | `new_order_single` | client |
| F | Order Cancel Request | `order_cancel_request` | client |
| G | Order Cancel/Replace Request (amend) | `order_cancel_replace_request` | client |
| q | Order Mass Cancel Request | `order_mass_cancel_request` | client |
| C | New Order Cross | not exported | client |
| 8 | Execution Report | `execution_report` | JSE |
| 9 | Order Cancel Reject | `order_cancel_reject` | JSE |
| r | Order Mass Cancel Report | `order_mass_cancel_report` | JSE |
| j | Business Reject | not exported | JSE |
| M, N, P | Missed Message Request, Missed Message Request Ack, Transmission Complete (recovery channel) | not exported (M appears only as `ref_message_type` of rejects) | client, JSE, JSE |
| n | System Status | not exported | JSE |
| Z | News | not exported | JSE |

## Rules for reading the data

- **Repeated rows.** Observed in the data: between 10% and 50% of rows in a file are exact copies of another row, usually with the same `timestamp` or one a few milliseconds later. To count messages, count distinct rows or distinct identifiers (for example `count(DISTINCT execution_id)` for execution reports, `count(DISTINCT client_order_id)` for new orders per `comp_id`) and say which you used. Never report a raw `count(*)` as a number of messages without saying it includes repeated rows.
- **Times.** `timestamp` is the Vonnegut capture time in South African time (SAST, UTC+2). `transact_time` is the JSE event time in UTC. Observed in the data: `transact_time` is 2 hours behind `timestamp`. Compare times with the session schedule (see the `trading_sessions` reference) in SAST, and say which column you used.
- **Missing columns.** Not every month has every column. Observed in the data: July execution reports have `order_status` but no `execution_type`; August execution reports have `execution_type` but no `order_status`; September has both. Check with `describe_table` before filtering on a column for a given month.
- **Placeholder values.** Observed in the data: `-1` in `reject_code`, `minimum_quantity` and `stop_price` means "not set". `NONE` in `order_id` of an Order Cancel Reject means the JSE could not find the order.
- **Reject codes** are stored without leading zeros (Volume 10 writes `001202`, the data `1202`).
- **Prices.** `executed_price`, `limit_price` and `stop_price` are in ZAC (South African cents) per share. Divide by 100 for Rand.
- **Comp ID.** `comp_id` (CompID, the Interface User ID) is the login name of one client connection. One firm (member) can have several CompIDs. The `logon` table also has a `compid` column holding the CompID inside the Logon message.
- **Two message type columns in rejects.** In the `reject` table, `message_type` is always `3`; `ref_message_type` is the type of the client message that was rejected.
- **Security ID** is the JSE numeric Instrument ID. The exports do not contain instrument symbols or segments; the reference data that maps them (Volume 09, the daily reference data file) is not available here.

## How to investigate a failed or disputed test

1. Identify the CompID, the test date and the test ID. If the analyst gives only a CompID, list that CompID's message types and distinct message counts per day to find the test day.
2. List the client's messages for that day in time order from `all_messages`, removing exact repeated rows.
3. For each step of the test in the `tests` reference, find the client's request and the JSE's reply, linked by `order_id` or `client_order_id`, and check the session in force at that time (see the `trading_sessions` reference).
4. Look for rejections and explain each with the `reject_codes` reference: `reject` rows (`ref_message_type`, `reject_code`, `reject_reason`), execution reports with `execution_type` 8, Order Cancel Rejects, Mass Cancel Reports with `status` 0, Logon Responses with a non-zero `reject_code`. Common causes in the data: price band (1202), wrong session (9008, 1524, 9015, 134007), unknown user or trader mnemonic (134200), order already gone (2000).
5. Check the process rules: a Logout or new Logon between steps that the test does not call for is a deviation; a missing step means the test was not completed; a step done in the wrong session (for example an IOC order during an auction) fails.
6. State the conclusion as: what the test requires, what the messages show (with the query used), and whether the messages support a pass or a fail. If the report says a scenario failed but the messages show every expected reply, say that the messages show the client completed it, and that the conformance configuration may need checking.
