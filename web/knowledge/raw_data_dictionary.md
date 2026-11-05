# Raw data dictionary: Vonnegut conformance exports, July to September 2026

36 Excel exports, 3,763,516 rows, in 11 datasets: one per message type. A dataset is the Excel files of one message type, combined in the bronze layer into one table with every month's rows. Every value in the exports is text, as Vonnegut wrote it; an empty cell has no value. Filled is the share of the dataset's rows with a value in the field. Months are those whose files have the column.

## Datasets

| Dataset | Type | Sent by | Jul rows | Aug rows | Sep rows | Files | Fields | One row is |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Logon `logon` | A | Client | 44,399 | 13,205 | 16,976 | 3 | 5 | A request to open a session on the JSE trading gateway. |
| Logon Response `logon_response` | B | JSE | 4,312 | 9,860 | 9,674 | 3 | 5 | The JSE reply to a Logon: accepted, accepted with a password warning, or refused. |
| Logout `logout` | 5 | Client or JSE | 4,249 | 11,065 | 5,992 | 3 | 4 | A message that ends a session. |
| New Order `new_order_single` | D | Client | 62,040 | 205,986 | 57,318 | 3 | 20 | A new order. |
| Order Cancel Request `order_cancel_request` | F | Client | 274,697 | 124,881 | 140,008 | 3 | 9 | A request to cancel one open order. |
| Order Cancel/Replace Request `order_cancel_replace_request` | G | Client | 282,791 | 160,352 | 486,808 | 3 | 16 | A request to amend one open order: a new quantity, price or time in force. |
| Order Mass Cancel Request `order_mass_cancel_request` | q | Client | 42 | 134 | 178 | 3 | 9 | A request to cancel many orders at once. |
| Execution Report `execution_report` | 8 | JSE | 76,466 | 438,816 | 183,880 | 4 | 24 | The JSE report of an event on an order: accepted, amended, cancelled, expired, rejected or traded. |
| Order Cancel Reject `order_cancel_reject` | 9 | JSE | 8,737 | 11,476 | 1,696 | 3 | 14 | The JSE reply that refuses a cancel or amend request. |
| Order Mass Cancel Report `order_mass_cancel_report` | r | JSE | 8 | 188 | 268 | 3 | 9 | The JSE reply to a mass cancel request, one per matching engine partition. |
| Reject `reject` | 3 | JSE | 126 | 1,032,324 | 94,564 | 5 | 12 | The JSE reply to a client message that failed the gateway's checks. |

## Fields in more than one dataset

| Field | Format in the export | Meaning | In datasets |
| --- | --- | --- | --- |
| Timestamp | Text: date, 24-hour time with 4 decimal places of a second, then a redundant am or pm, e.g. 2026-08-03 09:41:49.8992 am | When Vonnegut captured the message, in South African time (SAST, UTC+2). | Logon, Logon Response, Logout, New Order, Order Cancel Request, Order Cancel/Replace Request, Order Mass Cancel Request, Execution Report, Order Cancel Reject, Order Mass Cancel Report, Reject |
| Comp ID | Text: 6 letters and digits, e.g. GJEN09. Every CompID in the exports is fictitious. | The CompID of the client connection the message was sent on or to. A CompID is the login name of one client connection; one firm can have several. Empty on some JSE replies. | Logon, Logon Response, Logout, New Order, Order Cancel Request, Order Cancel/Replace Request, Order Mass Cancel Request, Execution Report, Order Cancel Reject, Order Mass Cancel Report, Reject |
| Message Type | Text: one character | The message type: A Logon, B Logon Response, 5 Logout, D New Order, F Order Cancel Request, G Order Cancel/Replace Request, q Order Mass Cancel Request, 8 Execution Report, 9 Order Cancel Reject, r Order Mass Cancel Report, 3 Reject. Every row of a dataset has its dataset's type. | Logon, Logon Response, Logout, New Order, Order Cancel Request, Order Cancel/Replace Request, Order Mass Cancel Request, Execution Report, Order Cancel Reject, Order Mass Cancel Report, Reject |
| Client Order ID | Text: up to 20 letters, digits and hyphens, e.g. 00178573862373600000 or 125-R1 | The ID the client gave its request. The JSE does not check that it is unique, and keeps it per CompID. On a JSE reply it is the ID of the client request the reply answers; on an execution report, the ID of the last request that changed the order. | New Order, Order Cancel Request, Order Cancel/Replace Request, Order Mass Cancel Request, Execution Report, Order Cancel Reject, Order Mass Cancel Report, Reject |
| Orig Client Order ID | Text, in the same form as Client Order ID. The header is "Original Client Order ID" in Order Cancel/Replace Request. | The Client Order ID of the order to cancel or amend. | Order Cancel Request, Order Cancel/Replace Request |
| Order ID | Text: 12 letters and digits starting with O, e.g. O0SGsBiEWvWV, or NONE | The JSE ID of the order, the same for the order's whole life. Empty on a cancel or amend request that names the order by its Orig Client Order ID instead. NONE on an Order Cancel Reject means the JSE could not find the order. | Order Cancel Request, Order Cancel/Replace Request, Execution Report, Order Cancel Reject |
| Order Book | Text: a code number. The header is "OrderBook" in Order Mass Cancel Request. | The order book: 1 Regular, the only value in the exports. | New Order, Order Cancel Request, Order Mass Cancel Request, Execution Report, Order Cancel Reject, Order Mass Cancel Report |
| Order Sub Type | Text: a code number. The header is "OrderSubType" in Order Mass Cancel Request. | 0 Order (normal), 50 Pegged to Mid, 51 Pegged to Bid, 52 Pegged to Offer. | New Order, Order Mass Cancel Request |
| Reject Code | Text: up to 6 digits, e.g. 1202; -1 means not set | The JSE reject code giving the reason for a rejection, as listed in JSE Volume 10 (Reject Codes and Reasons). | Logon Response, Execution Report, Order Cancel Reject, Order Mass Cancel Report, Reject |
| Transact Time | Text: date and time with up to 9 decimal places of a second, e.g. 2026-08-03 06:30:23.898764000 | When the JSE processed the event, in UTC: 2 hours behind Timestamp. | Execution Report, Order Cancel Reject, Order Mass Cancel Report |
| Side | Text: a code number | 1 Buy, 2 Sell. | New Order, Order Cancel Request, Order Cancel/Replace Request, Execution Report |
| Security ID | Text: up to 6 digits, e.g. 230 | The JSE numeric instrument ID. The exports hold no instrument names or segments. 0 in every mass cancel request in the exports. | New Order, Order Cancel Request, Order Cancel/Replace Request, Order Mass Cancel Request, Execution Report |
| Display Quantity | Text: a whole number | The visible quantity of the order, in shares: less than the order quantity for an iceberg order, 0 for a pegged order. | New Order, Order Cancel/Replace Request, Execution Report |
| Order Quantity | Text: a whole number | The number of shares ordered. | New Order, Order Cancel/Replace Request |
| Minimum Quantity | Text: a whole number; -1 means not set | The smallest quantity the order may trade in one execution; required for pegged orders. | New Order, Order Cancel/Replace Request |
| Limit Price | Text: a number with a thousands comma and 4 decimal places, e.g. 14,340.0000; -1.0000 also occurs | The limit price in South African cents (ZAC) per share: divide by 100 for Rand. | New Order, Order Cancel/Replace Request |
| Stop Price | Text: a number with a thousands comma and 4 decimal places, e.g. 14,340.0000; -1.0000 means not set | The price in ZAC at which a stop or stop limit order becomes active. | New Order, Order Cancel/Replace Request |
| Order Type | Text: a code number | 1 Market, 2 Limit, 3 Stop, 4 Stop Limit, 50 Pegged, 51 Pegged Limit. | New Order, Order Cancel/Replace Request |
| Time In Force | Text: a code number | How long the order stays open: 0 DAY (until the end of the trading day), 1 GTC Good Till Cancel, 3 IOC Immediate or Cancel, 4 FOK Fill or Kill, 5 OPG opening auction only, 6 GTD Good Till Date, 8 GTT Good Till Time, 9 GFA next auction only, 10 ATC closing auction only, 12 CPX Closing Price Cross, 51 GFX intraday auction. | New Order, Order Cancel/Replace Request |
| Execution Instruction | Text: a code number | 0 None, 2 Include in the end-of-day volume auction (the JSE removed this auction in May 2026). | New Order, Execution Report |
| Self Trade Prevention Key | Text: up to 12 characters; a few values hold unprintable characters | A key issued by the JSE that stops two orders with the same key trading with each other (self-match prevention). Used only with protocol version 3. | New Order, Execution Report |
| Partition ID | Text: a code number | The matching engine partition: 1 Equity, 2 Derivatives. | Order Cancel Reject, Order Mass Cancel Report |
| Source | Text: network address and port, e.g. 10.10.63.132:21501 | The network address the message was sent from, as captured by Vonnegut. | Order Cancel Reject, Reject |
| Destination | Text: network address and port, e.g. 156.48.0.148:58428 | The network address the message was sent to. | Order Cancel Reject, Reject |
| Bytes | Text: a whole number, with a thousands comma above 999 | The length of the message, in bytes. | Order Cancel Reject, Reject |
| Sequence No | Text: a whole number | The message sequence number. | Order Cancel Reject, Reject |
| Packet ID | Text, e.g. range = 0-58 / initial packet = TS 2026-08-17T14:04:28.9927408+02:00 IDENT 0 SEQ 228637688 ACK 3341791649 PLEN 59 | A description of the captured network packet: the byte range of the message, the packet's capture time, and its network sequence and acknowledgement numbers. | Order Cancel Reject, Reject |

## Fields of each dataset

### Logon

type A · Client · 74,580 rows · `logon`

Files: August_2026/Logon.xlsx; July_2026/Logon.xlsx; September_2026/Logon [A].xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| CompID | Text, in the same form as Comp ID | The CompID written inside the Logon message. | all | 100% |
| Protocol Version | Text: a code number | The version of the gateway protocol the client uses: 1, 2 (needed for iceberg orders) or 3 (needed for self-match prevention); 0 means the system default. | all | 100% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 100% |
| Message Type | all | 100% |

### Logon Response

type B · JSE · 23,846 rows · `logon_response`

Files: August_2026/Logon Response [B].xlsx; July_2026/Logout [B].xlsx; September_2026/Logon Response [B].xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Password Expiry | Text: a whole number; -1 means not set | Days until the CompID's password expires. -1 in every row of the exports. | all | 100% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 78% |
| Message Type | all | 100% |
| Reject Code | all | 100% |

### Logout

type 5 · Client or JSE · 21,306 rows · `logout`

Files: August_2026/Logout.xlsx; July_2026/Logout[5].xlsx; September_2026/Logout.xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Reason | Text, at most 20 characters | Why the session ended, in free text, e.g. User logout received, Force Logout on End (JSE end of day), HB expired (heartbeats missed). | all | 75% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 88% |
| Message Type | all | 100% |

### New Order

type D · Client · 325,344 rows · `new_order_single`

Files: August_2026/New Order [D].xlsx; July_2026/New Order [D].xlsx; September_2026/New Order.xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Account | Text: up to 10 characters, almost all digits | The client account the order is for. | Aug | 63% |
| Cancel on Disconnect | Text: a code number | Whether the JSE cancels the order if the session disconnects: 0 Do not cancel, 1 Cancel. | all | 100% |
| Capacity | Text: a code number | The capacity the firm trades in: 2 Principal (its own account), 3 Agency (for a client). 0 also occurs and is not in the JSE list. | Jul | 19% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 100% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Order Book | Jul | 19% |
| Order Sub Type | Jul, Aug | 82% |
| Side | Jul, Aug | 82% |
| Security ID | all | 100% |
| Display Quantity | all | 100% |
| Order Quantity | Jul, Aug | 82% |
| Minimum Quantity | all | 100% |
| Limit Price | Jul, Aug | 82% |
| Stop Price | Jul, Aug | 82% |
| Order Type | all | 100% |
| Time In Force | Jul, Aug | 82% |
| Execution Instruction | all | 100% |
| Self Trade Prevention Key | all | 0.2% |

### Order Cancel Request

type F · Client · 539,586 rows · `order_cancel_request`

Files: August_2026/Order Cancel Request[F].xlsx; July_2026/Order Cancel Request[F].xlsx; September_2026/Order Cancel Request [F].xlsx

No field of its own: every field is in another dataset too.

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 100% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Orig Client Order ID | all | 99% |
| Order ID | all | 9% |
| Order Book | Jul, Aug | 74% |
| Side | all | 100% |
| Security ID | all | 100% |

### Order Cancel/Replace Request

type G · Client · 929,951 rows · `order_cancel_replace_request`

Files: August_2026/Order Cancel Replace Request[G].xlsx; July_2026/Order Cancel Replace Request [G].xlsx; September_2026/Order Cancel Replace Request [G].xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Expire Time | Empty in every row | The time a GTT order expires. | Sep | 0% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 100% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Orig Client Order ID | all | 84% |
| Order ID | all | 20% |
| Side | all | 100% |
| Security ID | all | 100% |
| Display Quantity | all | 100% |
| Order Quantity | Jul | 30% |
| Minimum Quantity | all | 100% |
| Limit Price | all | 100% |
| Stop Price | Aug | 17% |
| Order Type | all | 100% |
| Time In Force | all | 100% |

### Order Mass Cancel Request

type q · Client · 354 rows · `order_mass_cancel_request`

Files: August_2026/Order Mass Cancel Request.xlsx; July_2026/Order Mass Cancel Request.xlsx; September_2026/Order Mass Cancel Request [q].xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Mass Cancel Request Type | Text: a code number | Which orders to cancel: 3 all firm orders for an instrument, 4 all firm orders for a segment, 7 all orders of this CompID, 8 all orders of the firm, 9 this CompID's orders for an instrument, 15 this CompID's orders for a segment. | all | 100% |
| Segment | Empty in every row | The market segment whose orders are cancelled. | all | 0% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 100% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Order Book | Jul, Sep | 62% |
| Order Sub Type | all | 100% |
| Security ID | all | 100% |

### Execution Report

type 8 · JSE · 699,162 rows · `execution_report`

Files: August_2026/Execution Report 1.xlsx; August_2026/Execution Report 2.xlsx; July_2026/Execution Report [8].xlsx; September_2026/Execution Report.xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Execution ID | Text: 12 letters and digits starting with E, e.g. E0SGs6sBxGkz | The JSE ID of this execution report, unique. | all | 100% |
| Working Indicator | Text: a code number | Set only when Order Status is 0: 0 Unset, 1 the order is being worked, 2 not currently working (a stop order not yet triggered). | all | 100% |
| TypeofTrade | Text: a code number | Trades only: 0 visible passive, 1 hidden passive, 2 not specified (the executed part was aggressive), 3 pegged passive. | all | 100% |
| Public Order ID | Text, in the same form as Order ID | The order ID shown to the market: equal to Order ID except for iceberg orders, where it changes each time the visible quantity is refilled. | all | 100% |
| Leaves Quantity | Text: a whole number | The quantity of the order still open after the event. | Jul, Aug | 74% |
| Liquidity Indicator | Text: a code number | Trades only: 0 Unset, 1 added liquidity (passive), 2 removed liquidity (aggressive), 4 auction. | Jul, Aug | 74% |
| Execution Type | Text: a code number or letter | What happened: 0 New (accepted), 4 Cancelled, 5 Amended, 8 Rejected (reason in Reject Code), 9 Suspended, C Expired, F Trade, G Trade Correct, H Trade Cancel, D Restated, L Triggered. | Aug, Sep | 89% |
| Executed Quantity | Text: a whole number | The number of shares traded in this report; 0 when the report is not a trade. | all | 100% |
| Executed Price | Text: a number with a thousands comma and 4 decimal places, e.g. 14,340.0000 | The trade price in ZAC; 0.0000 when the report is not a trade. | all | 100% |
| Indicator Flags | Text: a code number | Trades only: 1 this order was the aggressor, 0 passive (both sides are 0 in an auction). | Jul, Sep | 37% |
| Order Status | Text: a code number | The state of the order after the event: 0 New, 1 Partially Filled, 2 Filled, 4 Cancelled, 6 Expired, 8 Rejected, 9 Suspended. | Jul, Sep | 37% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 74% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Order ID | all | 100% |
| Order Book | Jul | 11% |
| Reject Code | all | 100% |
| Transact Time | Jul, Aug | 74% |
| Side | all | 100% |
| Security ID | Jul | 11% |
| Display Quantity | all | 100% |
| Execution Instruction | Aug, Sep | 89% |
| Self Trade Prevention Key | Jul, Sep | 0.1% |

### Order Cancel Reject

type 9 · JSE · 21,909 rows · `order_cancel_reject`

Files: August_2026/Order Cancel Reject[9].xlsx; July_2026/Order Cancel Reject.xlsx; September_2026/Order Cancel Reject.xlsx

No field of its own: every field is in another dataset too.

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 97% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Order ID | Jul, Aug | 92% |
| Order Book | all | 100% |
| Reject Code | all | 100% |
| Transact Time | all | 100% |
| Partition ID | Jul | 40% |
| Source | Sep | 8% |
| Destination | Sep | 8% |
| Bytes | Sep | 8% |
| Sequence No | Sep | 8% |
| Packet ID | Sep | 8% |

### Order Mass Cancel Report

type r · JSE · 464 rows · `order_mass_cancel_report`

Files: August_2026/Order Mass Cancel Report.xlsx; July_2026/Order Mass Cancel Report.xlsx; September_2026/Order Mass Cancel Report [r].xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Status | Text: a code number | The result of the mass cancel request: 7 Accepted, 0 Rejected (reason in Reject Code). | all | 100% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 89% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Order Book | all | 100% |
| Reject Code | all | 100% |
| Transact Time | all | 100% |
| Partition ID | all | 100% |

### Reject

type 3 · JSE · 1,127,014 rows · `reject`

Files: August_2026/Reject 1.xlsx; August_2026/Reject 2.xlsx; August_2026/Reject 3.xlsx; July_2026/Rejects.xlsx; September_2026/Reject.xlsx

| Field | Format in the export | Meaning | Months | Filled |
| --- | --- | --- | --- | --- |
| Message Type.1 | Text: one character. The second column headed "Message Type"; stored as "Message Type.1" in the combined bronze table. | The type of the client message that was rejected, e.g. D New Order. M is a recovery request, which the exports do not otherwise contain. | all | 100% |
| Reject Reason | Text | The field or reason named by the gateway, e.g. Unknown User, Account, Maximum message rate exceeded. | all | 100% |

Fields also in other datasets, described under Fields in more than one dataset

| Field | Months | Filled |
| --- | --- | --- |
| Timestamp | all | 100% |
| Comp ID | all | 100% |
| Message Type | all | 100% |
| Client Order ID | all | 100% |
| Reject Code | all | 100% |
| Source | Aug | 87% |
| Destination | Aug | 87% |
| Bytes | Aug | 87% |
| Sequence No | Aug | 87% |
| Packet ID | Aug | 87% |
