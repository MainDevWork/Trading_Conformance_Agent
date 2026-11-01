# Reject codes

The Native gateway sends a reject code in four places: Reject `3` (gateway validation, with `reject_reason` naming the field), Execution Report `8` with `execution_type` 8 (matching engine), Order Cancel Reject `9`, and Logon Response `B`. On a Logon Response, codes 0 and 3 mean the logon succeeded, so they are not rejections. `is_rejection` in `fact_message` is true only for the messages that are rejections; filter on it when listing or counting reject codes.

**Codes observed in the data, with their Volume 10 meaning**

Reject `3`. Observed in the data: about 1.09 million export rows (about 0.7 million distinct messages), almost all `134200` on New Orders; check whether one CompID sending to an unknown user dominates before drawing conclusions about rejects.

| Code | Meaning | `reject_reason` seen |
|---|---|---|
| 107 | Not logged in (message sent before logon completed) | Not Logged in |
| 9907 | Value not allowed for field | (field name) |
| 9908 | Invalid value in field | Account, Capacity, Partition ID, Sequence Number, … |
| 9910 | Required field is empty | Account, Password, … |
| 9911 | Native message not supported (unknown message type, for example `M` sent on the real-time channel) | Msg Type |
| 9912 | Invalid message length for native message | Msg Length |
| 9914 | Invalid character in field | (field name) |
| 9990 | Maximum message rate exceeded | Maximum message rate exceeded |
| 134200 | Unknown User (the trader mnemonic or user in the message is not registered) | Unknown User |
| 162002 | Instrument not found | Instrument not found |

Execution Report with `execution_type` 8:

| Code | Meaning |
|---|---|
| 1201 | Invalid limit price (not multiple of tick) |
| 1202 | Invalid limit price (price band breached) — the most common rejection in the data |
| 1204 | Invalid limit price (< minimum price) |
| 1207 | Invalid limit price (not equal to closing price) — CPX session |
| 1227 | Expired (circuit breaker breached) |
| 1507 | Invalid TIF (OPG not permitted outside opening auction call) |
| 1524 | Invalid TIF (not permitted during this session) — for example IOC/FOK in an auction |
| 1940 | Cannot Enter Cross Orders (Price range Not Available) |
| 1942 | Price Outside applicable range for Cross Order |
| 8001 | Invalid client order ID |
| 9003 | Instrument halted or suspended |
| 9005 | Market is closed |
| 9008 | Session is closed |
| 9015 | Instrument in Closing Price Publication session |
| 134007 | Cannot submit/amend orders in session |

Order Cancel Reject:

| Code | Meaning |
|---|---|
| 1106 | Fully hidden orders disabled for instrument |
| 1202 | Invalid limit price (price band breached) — amend rejected |
| 2000 | Order not found (too late to cancel or unknown order) — the order was already filled, cancelled or expired, or the ID is wrong; `order_id` shows `NONE` |
| 3000 | Invalid order size (< filled size) |
| 3905 | Invalid price (price may not be better than closing price) |
| 8001 | Invalid client order ID |
| 9008 | Session is closed |
| 9015 | Instrument in Closing Price Publication session |

Logon Response:

| Code | Meaning |
|---|---|
| 0 | Login successful |
| 1 | Invalid User ID or password |
| 3 | Login accepted; new password does not comply with the password policy |
| 8 | Account locked |
| 9 | Account expired |
| 100 | Not logged into real-time channel (logon to the recovery channel before the real-time channel) |
| 626 | Account suspended (this is the expected result in test G1-001 while the CTA has suspended the CompID) |
| 630 | System is in End of Day (logon attempted after the trading day ended) |
| 9903 | Concurrent login limit reached |
| 9905 | System unavailable (to sponsored users) |

Order Mass Cancel Report: observed in the data, every report has `mass_cancel_status` 7 (accepted) and no `reject_code`.

For any other code, call `lookup_reject_codes`; it returns every Volume 10 entry for a code (reason, message types and the system that sends it). If a code is not in Volume 10, report the code and any `reject_reason` text and say its meaning is not in the documents provided.
