# Client report template: the layout of the report to the client

`Web_code/reports/client_report.js` writes the report from the results of a checked client report. The Excel report has the two sheets below. The PDF report is the trading conformance assessment described at the end. Test steps the client gave no response for are left out of both files. Text in angle brackets says what goes in the cell.

## Sheet: Summary

Conformance test results

| Item | Value |
| --- | --- |
| Client CompID | <CompIDs in the client's report> |
| Client report checked | <file name of the client's Volume 202 report> |
| Checked on | <date of the check, day/month/year> |
| Messages checked | JSE Trading FIX message data, 01/07/2026 to 30/09/2026 |
| Overall result | <Not passed if any step failed; Needs analyst review if any step needs review; otherwise Passed, for the tests the exported messages can check> |
| Test steps: Pass | <number of steps> |
| Test steps: Fail | <number of steps> |
| Test steps: Needs review | <number of steps> |
| Test steps: Not checkable | <number of steps> |
| Mandatory steps with no response | <test IDs marked Mandatory Y, for All or Equity Market, with no response and no N/A comment> |
| JSE comments | <a short paragraph to the client: the overall result, which steps failed and what to redo> |

| Result | What it means |
| --- | --- |
| Pass | The messages show the test step was done as Volume 202 requires. |
| Fail | The messages show the test step was not done as required, or the report's details do not match the messages. The reason says what is wrong. |
| Needs review | The messages do not settle the result, for example because some messages are not in the export or the report's test time is wrong. A JSE analyst decides. |
| Not checkable | The step uses a gateway or service whose messages are not in the exports (market data, Post Trade, Drop Copy, FIX, derivatives). |

## Sheet: Test results

One row per test step the client gave a response for.

| Column | What goes in it |
| --- | --- |
| Ref | <Ref, e.g. T3.6> |
| Test case ID | <Test case ID, e.g. T3-006> |
| Test | <the test step, as worded in Volume 202> |
| Mandatory | <Y or N, from the report> |
| CompID | <CompID the client gave> |
| Test time in report | <test time the client gave> |
| Time of the messages | <date and time of the message nearest the client's test time> |
| Result | <Pass, Fail, Needs review or Not checkable> |
| Reason | <why: what the messages show against what the test needs, and any detail in the report that does not match the messages, such as a wrong test time> |
| What the messages show | <each order the client's IDs lead to: its type, when it was entered, and every message after it with its time; for logon and mass cancel tests, the session messages> |
| IDs found | <IDs from the report found in the messages> |
| IDs not found | <IDs from the report not in the messages> |
| Client comment | <the client's comment> |
| JSE comment in report | <the JSE comment already in the client's report> |

## PDF: trading conformance assessment

Written by `Web_code/reports/assessment_pdf.js`, in the layout of `Updates/WKP_Trading_Conformance_Client_Report_Card_Format.pdf`. Only trading tests the Trading FIX message data can check are assessed; Not checkable steps are named in the scope line.

Page 1:

| Part | What goes in it |
| --- | --- |
| Title line | <CompIDs> \| Client conformance result \| Trading only \| <date of the latest message assessed, e.g. 09 September 2026> |
| Overall result | FAIL - <failed tests + required tests with no evidence> OF <tests> TESTS NEED ACTION; or REVIEW - <n> OF <tests> TESTS AWAIT A JSE DECISION; or PASS - ALL <tests> TESTS PASSED |
| Counts | Required tests (Mandatory Y, All or Equity Market, no exemption); Evidence provided (required tests the client answered); Passed; Failed; Needs review (only when above 0); Pass rate (passed / tests); Retest / fix (tests needing action / tests) |
| Executive decision | <how many tests were assessed and their results; required tests with evidence; required tests with no evidence; the approval decision; the scope; the JSE comment to the client> |
| Ring chart | <share of tests passed (green), needing review (orange) and needing action (red)> |
| Assessment and specification controls | Required tests, Client evidence, Message and field validation, Timing and correlation, Pass criteria, Traceability, Messages checked |

Then one section per result, each starting on a new page: Passed tests, Failed tests, Tests for JSE review. One table per test:

| Row | What goes in it |
| --- | --- |
| TEST | <test case ID> - <test, as worded in the report> |
| REQUEST | <the message the client had to send, from `criteriaFor` in `conformance.js`>; <CompID and test time in the client's report> |
| RESPONSE | <the response the gateway had to return> |
| CONFIGURED CRITERIA | <the checks the rule for the test applies> |
| ACTUAL OBSERVED | <the reason for the result, then what the messages show> |
| CONCLUSION | PASS. All configured checks passed. / FAIL. <what to redo> / NEEDS REVIEW. A JSE analyst decides the result from the messages. |

The last section ends with the approval condition (the failed tests to repeat, the required tests with no evidence, the tests for JSE review) and the assessment reference (JSE Volume 01E v4.05, Volume 202 v3.08, the message dates and the client's file name).
