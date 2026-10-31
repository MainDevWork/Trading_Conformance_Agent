# Trading tests that the exported tables can check

Each test must be repeated for each trading interface the client uses (Native and FIX); these tables hold the Native part. For each test, find the client's messages by `comp_id` and test date, link them by `order_id` and `client_order_id`, check the session from the time, and compare what happened with the expected result. Every T2 and T3 step expects an Execution Report, and the client records CompID, Order ID, Client Order ID and Execution ID(s).

| Test | Mandatory | What the client does | What the data must show |
|---|---|---|---|
| T1-001 Logon | Yes | Connect, log on, change password | Logon `A`, then Logon Response `B` with `reject_code` 0 (or 3) |
| T1-002 Logon, protocol 2 | No | Log on with `protocol_version` 2 | Logon with `protocol_version` 2, Logon Response 0 |
| T1-003 Logon, protocol 3 | No | Log on with `protocol_version` 3 (self-match prevention) | Logon with `protocol_version` 3, Logon Response 0 |
| T2-001 Auction market order | Yes | Market order (`order_type` 1) during the opening or closing auction | `0` (rests until uncross), then `F` at the uncross (`liquidity_indicator` 4). IOC/FOK is not allowed in auctions (code 1524) |
| T2-002 Auction limit order | Yes | Limit order (`order_type` 2) during an auction | `0`, then `F` at the uncross |
| T3-001 Aggressive market order | Yes | Market order with IOC (3) or FOK (4) in continuous trading | Immediate `F`; any IOC remainder `C` |
| T3-002 Aggressive limit order | Yes | Limit order with IOC or FOK in continuous trading | Immediate `F` |
| T3-003 Passive limit order | Yes | Limit order that rests, then is matched | `0`, later `F` up to the limit price (`liquidity_indicator` 1) |
| T3-004 Stop order | Yes | Stop order (`order_type` 3) | `0` with `working_indicator` 2 (unelected), then `L` or `F` once the stop price is reached |
| T3-005 Stop limit order | Yes | Stop limit order (`order_type` 4) | `0` unelected, then elected and `F` |
| T3-006 Amend | Yes | Enter an order that rests, then send `G` | `0`, then `5`. An Order Cancel Reject `9` means the amend failed |
| T3-007 Cancel | Yes | Enter an order that rests, then send `F` | `0`, then `4` with `order_status` 4. An Order Cancel Reject means the cancel failed (code 2000 if the order was already gone) |
| T3-008 Mass cancel | Yes | Enter 5 non-executable orders, then send `q` | 5 × `0`, then `r` with `status` 7, and `4` for each of the 5 orders carrying the mass cancel's `client_order_id` |
| T3-009 Cancel on disconnect | Yes | Enter 5 non-executable orders with `cancel_on_disconnect` 1, drop the connection, log on again | 5 × `0`; after the disconnect each order gets `C` with `order_status` 6 (Expired, not Cancelled); a new Logon and Logon Response |
| T3-013 Self-match prevention, Native | No | Log on with protocol 3; enter a resting limit order with a `self_trade_prevention_key`, then an aggressive limit order with the same key, in continuous trading | First order `0` carrying the key; then the resting order `C` carrying the key and no trade between them. Allowed TIF: DAY, IOC, FOK, GTC, GTT, GTD, CPX |
| T3-016 Self-match amend, Native | No | Enter a resting order with a key, then amend it | `0`, then `5`; the key is unchanged |
| T25-001 Self-match in CPX, Native | No | As T3-013, during the Closing Price Cross session | As T3-013 |
| T4-001 Native recovery | Yes | Enter 5 orders, disconnect, wait, log on to real-time and recovery channels with the same CompID, request missed messages, log out of recovery within 3 heartbeats | The orders and their execution reports, a Logout or gap, then new Logons. Recovery messages (`M`, `N`, `P`) are not exported, so only partly checkable. A Logon Response 100 means the client logged on to recovery before real-time |
| T10-001 Order cancelled by the CTA | Yes (CTA) | Enter an order that rests; the CTA cancels it | `0`, then an unsolicited `4` with no Order Cancel Request from the client |
| T10-002 Trade cancelled by the CTA | Yes (CTA) | Generate an on-book trade; the CTA cancels the trade | `F`, then `H` carrying the trade's `execution_id`, and a report reinstating or reducing the order (`D` or `4`) |
| T12-001 Pegged order (trading part) | Yes | Pegged order (`order_type` 50, `order_sub_type` 50/51/52, `display_quantity` 0, `minimum_quantity` set) in continuous trading | `0`. An `F` with `typeoftrade` 3 shows it traded. T12-002 (Drop Copy) and T12-003 (Post Trade) cannot be checked |
| T13-001 Pegged limit order (trading part) | Yes | As T12-001 with `order_type` 51 and the hard limit in `stop_price` | `0`. T13-002 and T13-003 cannot be checked |
| T14-001 EOD volume auction order | Yes in Volume 201 | GDX order (`time_in_force` 50) | Volume 00E v4.09 (28/05/2026) removed the EOD volume auction and GDX, so a GDX order may now be rejected; say so if asked |
| T20-001 Iceberg order | Yes | Log on with protocol 2 or higher; order with `display_quantity` above 0 and below `order_quantity` in continuous trading | `0` with that `display_quantity` |
| T20-002 Trade against an iceberg | Yes | Another order trades through the visible and hidden parts | `F` reports on the iceberg order; `public_order_id` differs from `order_id` after a refill. Step 4 (MITCH market data) and T20-003 cannot be checked |
| T21-001 Liquidity indicator | Yes | Order in continuous trading that is partly or fully filled | `F` with `order_status` 1 or 2 and `liquidity_indicator` 1 or 2 |
| T22-001 Working indicator | Yes | Order in continuous trading accepted as New | `0` with `order_status` 0 and `working_indicator` 1 or 2 |
| G1-001 Logon while suspended | Yes (CTA) | CTA suspends the CompID; client tries to log on; CTA un-suspends; client logs on | A Logon Response with `reject_code` 626 (account suspended), then later 0 |
| OT1-001 Cancel from another CompID | Optional | Enter an order on one CompID, cancel it from a different CompID of the same firm | Cancel Request from a second `comp_id` naming the `order_id`; Execution Report `4` |

# Tests the exported tables cannot check

These need messages that are not in the exports. Say so if asked about them.

- T3-014, T3-015, T25-002 (self-match prevention on the FIX gateway), G2-001 heartbeats and G2-002 resend request (FIX gateways only).
- T5 and T6 Post Trade Gateway trade reports, T7 post contra trades and same-day cancellation of on-book trades, T8 Own Trades Book Download (Trade Capture Report messages on the FIX Post Trade Gateway).
- T9 Drop Copy Gateway logon and Own Order Book Download, and the Drop Copy and Post Trade steps of T11 to T14 and T20-003.
- T10-003 (trade report by the CTA, Post Trade) and T10-004 (News message `Z`, not exported).
- T11 cross orders (New Order Cross `C` is not exported; only rejects of it appear, as `ref_message_type` C).
- T15 to T19 derivatives tests (Native Enhanced Gateway), T23 circuit breaker alerts (Drop Copy), T24 FX auction (Native Heavy Gateway, banks only).
- I1 to I13 market data tests (FIX/FAST and MITCH replay and recovery services, instrument suspension, closing price, extended statistics).
