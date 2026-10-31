# Field codes

**New Order and Order Cancel/Replace Request**

| Column | Values |
|---|---|
| `side` | 1 Buy, 2 Sell |
| `order_type` | 1 Market, 2 Limit, 3 Stop, 4 Stop Limit, 50 Pegged, 51 Pegged Limit |
| `time_in_force` | 0 DAY (expires at market end), 1 GTC Good Till Cancel (up to 90 days), 3 IOC Immediate or Cancel, 4 FOK Fill or Kill, 5 OPG At the Open (opening auction only), 6 GTD Good Till Date (up to 90 days), 8 GTT Good Till Time, 9 GFA Good for Auction (next auction only), 10 ATC At the Close (closing auction only), 12 CPX Closing Price Cross (CPX session only), 51 GFX Good for Intraday Auction, 50 GDX Good for EOD Volume Auction Uncross (removed: Volume 00E v4.09 of 28/05/2026 removes the EOD volume auction and GDX) |
| `capacity` | 2 Principal, 3 Agency |
| `cancel_on_disconnect` | 0 Do not cancel, 1 Cancel |
| `execution_instruction` | 0 None, 2 Include in EOD Volume Auction Uncross (removed with GDX) |
| `order_sub_type` | 0 Order (normal), 50 Pegged to Mid, 51 Pegged to Bid, 52 Pegged to Offer |
| `order_book` | 1 Regular |
| `display_quantity` | visible quantity; 0 for pegged orders |
| `minimum_quantity` | minimum execution size; required for pegged orders |
| `self_trade_prevention_key` | key issued by the JSE for self-match prevention; Protocol Version 3 only |

**Execution Report**

| Column | Values |
|---|---|
| `execution_type` | 0 New (accepted), 4 Cancelled, 5 Amended, 8 Rejected (see `reject_code`), 9 Suspended, C Expired, F Trade (partly or fully filled), G Trade Correct, H Trade Cancel, D Restated (amended by JSE Market Operations or CPX re-pricing), L Triggered (parked or stop order activated) |
| `order_status` | 0 New, 1 Partially Filled, 2 Filled, 4 Cancelled, 6 Expired, 8 Rejected, 9 Suspended. If several apply, the highest precedence is reported: 2, 9, 4, 6, 1, 0, 8 |
| `working_indicator` | only when `order_status` is 0: 0 Unset, 1 Order is being worked (elected on entry), 2 Not currently working (unelected stop or stop limit) |
| `liquidity_indicator` | only on trades: 0 Unset, 1 Added liquidity (passive), 2 Removed liquidity (aggressive), 4 Auction |
| `typeoftrade` | only on trades: 0 Visible passive, 1 Hidden passive, 2 Not specified (the executed portion was aggressive), 3 Pegged passive |
| `indicator_flags` | only on trades: 1 = this order was the aggressor, 0 = passive; both sides 0 in auctions |
| `executed_quantity`, `executed_price` | only when `execution_type` is F or G |
| `leaves_quantity` | quantity still open |
| `reject_code` | only when `execution_type` is 8 (see the `reject_codes` reference) |

Which `order_status` goes with each `execution_type`: 0 New → 0; 8 Rejected → 8; F Trade → 1 or 2; C Expired → 6; 4 Cancelled → 4; 5 Amended → 0 or 1; L Triggered → 0 or 1; 9 Suspended → 9; D Restated → 0 or 1; H Trade Cancel → 0, 1, 4 or 6; G Trade Correct → 1, 2, 4 or 6.

Typical sequences: accepted order `0`; trade `F`; amend `5`; cancel `4`; IOC/FOK remainder, end of day, cancel on disconnect or circuit breaker `C` with status 6; stop order entered `0` with `working_indicator` 2, then `L` or `F` when elected. A trade cancelled by the JSE gives `H` for the trade and a second report restating or cancelling the order quantity.

**Order Mass Cancel Request and Report**

| Column | Values |
|---|---|
| `mass_cancel_request_type` | 3 All firm orders for an instrument, 4 All firm orders for a segment, 7 All orders for this CompID, 8 All orders for the firm, 9 This CompID's orders for an instrument, 15 This CompID's orders for a segment (types 14 and 22 are rejected by the Basic gateway) |
| `status` (report) | 7 Accepted, 0 Rejected (reason in `reject_code`) |

After an accepted mass cancel the JSE sends an Execution Report `4` for each cancelled order and an Order Cancel Reject `9` for each order it could not cancel, all carrying the mass cancel request's `client_order_id`. A mass cancel during the Start of Trading session is rejected.

**Logon, Logon Response, Logout**

- `protocol_version` (Logon): 1, 2 or 3; empty or 0 means the system default. Version 2 is required for iceberg orders; version 3 for self-match prevention.
- `reject_code` (Logon Response): see the `reject_codes` reference. 0 means logged in; 3 means logged in but the new password does not meet the password policy; any other value means the logon was rejected and the JSE disconnected.
- `password_expiry`: days until the password expires; negative means not applicable.
- `reason` (Logout): free text. Observed in the data: "User logout received" (normal client logout), "Force Logout on End" (JSE end of day), "HB expired" (heartbeats missed), "Requested disconnect", "Recovery is done." and "recovery complete" (recovery channel), "session stop time", "Message limit exceed", "conformance test com…" and "conformance session …" (texts cut to 20 characters), and empty.

**FIX values that differ from Native (Volume 00E Appendix G)** — use only to translate if an analyst quotes FIX values: order type Pegged FIX `P` = Native 50, Pegged Limit `R` = 51; TIF OPG FIX `2` = Native 5, ATC `7` = 10, GFX `8` = 51, GTT `6` = 8, CPX `a` = 12; order status Expired FIX `C` = Native 6; capacity Principal FIX `P` = Native 2, Agency `A` = 3.
