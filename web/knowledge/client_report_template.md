# Client report template: the layout of the report to the client

`web/client_report.js` writes the report from the results of a checked client report. The Excel report has the three sheets below. The PDF report has the Summary, then the test results. Text in angle brackets says what goes in the cell.

## Sheet: Summary

Conformance test results

| Item | Value |
| --- | --- |
| Client CompID | <CompIDs in the client's report> |
| Client report checked | <file name of the client's Volume 202 report> |
| Checked on | <date of the check, day/month/year> |
| Messages checked | JSE Vonnegut exports of the Native Trading Gateway, 01/07/2026 to 30/09/2026 |
| Overall result | <Not passed if any step failed; Needs analyst review if any step needs review; otherwise Passed, for the tests the exported messages can check> |
| Test steps: Pass | <number of steps> |
| Test steps: Fail | <number of steps> |
| Test steps: Needs review | <number of steps> |
| Test steps: Not checkable | <number of steps> |
| Test steps: Not attempted | <number of steps> |
| Mandatory steps with no response | <test IDs marked Mandatory Y, for All or Equity Market, with no response and no N/A comment> |
| JSE comments | <a short paragraph to the client: the overall result, which steps failed and what to redo> |

| Result | What it means |
| --- | --- |
| Pass | The messages show the test step was done as Volume 202 requires. |
| Fail | The messages show the test step was not done as required, or the report's details do not match the messages. The reason says what is wrong. |
| Needs review | The messages do not settle the result, for example because some messages are not in the export or the report's test time is wrong. A JSE analyst decides. |
| Not checkable | The step uses a gateway or service whose messages are not in the exports (market data, Post Trade, Drop Copy, FIX, derivatives). |
| Not attempted | The client gave no response for this step. |

## Sheet: Test results

One row per test step.

| Column | What goes in it |
| --- | --- |
| Ref | <Ref, e.g. T3.6> |
| Test case ID | <Test case ID, e.g. T3-006> |
| Test | <the test step, as worded in Volume 202> |
| Mandatory | <Y or N, from the report> |
| CompID | <CompID the client gave> |
| Test time in report | <test time the client gave> |
| Time of the messages | <date and time of the message nearest the client's test time> |
| Result | <Pass, Fail, Needs review, Not checkable or Not attempted> |
| Reason | <why: what the messages show against what the test needs, and any detail in the report that does not match the messages, such as a wrong test time> |
| What the messages show | <each order the client's IDs lead to: its type, when it was entered, and every message after it with its time; for logon and mass cancel tests, the session messages> |
| IDs found | <IDs from the report found in the messages> |
| IDs not found | <IDs from the report not in the messages> |
| Client comment | <the client's comment> |
| JSE comment in report | <the JSE comment already in the client's report> |

## Sheet: Messages

One row per message found for a test step.

| Column | What goes in it |
| --- | --- |
| Ref | <Ref, e.g. T3.6> |
| Test case ID | <Test case ID, e.g. T3-006> |
| Time | <date and time of the message> |
| CompID | <CompID that sent or received it> |
| Message | <message, e.g. New Order, Execution Report> |
| Event | <what the execution report says happened, e.g. Trade, Cancelled> |
| Order ID | <order ID> |
| Client order ID | <client order ID> |
| Execution ID | <execution ID> |
| Order type | <order type> |
| Order status | <order status> |
| Display quantity | <display quantity> |
| Executed quantity | <quantity traded> |
| Self-trade prevention key | <self-trade prevention key> |
| Reject code | <reject code> |
| Reject meaning | <its meaning> |
