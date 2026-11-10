# Trading day (Volume 00E, times in SAST)

Equity segments: ZA01 Top Companies (Top 40 and JSE/UK dual listed), ZA02 Medium Liquid, ZA03 Less Liquid (including AltX and BEE), ZA04 Specialist Products (warrants, investment products), ZA06 Exchange Traded Products (ETFs, ETNs), ZA11 NSX Local, ZA12 NSX/JSE Dual Listed. The exports do not say which segment an instrument is in.

Normal day, on-book trading:

| Segment | Start of Trading | Opening Auction | Continuous Trading | Intraday Auction | Closing Auction | Closing Price Publication | Closing Price Cross | Post Close |
|---|---|---|---|---|---|---|---|---|
| ZA01, ZA02 | 07:00–08:30 | 08:30–09:00 | 09:00–16:50 | – | 16:50–17:00 | 17:00–17:02 | 17:02–17:10 | 17:15–18:15 |
| ZA03, ZA11 | 07:00–08:30 | 08:30–09:00 | 09:00–12:00 and 12:15–16:50 | 12:00–12:15 | 16:50–17:00 | 17:00–17:02 | 17:02–17:10 | 17:15–18:15 (ZA11 17:10–18:15) |
| ZA04 | 07:00–08:30 | 08:30–09:10 | 09:10–16:49 | – | – | 16:49–16:50 | – | 16:50–18:15 |
| ZA06 | 07:00–09:00 | – | 09:00–16:50 | – | – | 16:50–16:52 | 16:52–17:00 | 17:00–18:15 |
| ZA12 | 07:00–08:30 | 08:30–09:00 | 09:00–17:00 | – | 17:00–17:10 | 17:10–17:12 | 17:12–17:20 | 17:20–18:15 |

Early close day: continuous trading ends at 11:50 (ZA04 11:49, ZA12 12:00), closing auction 11:50–12:00, CPP 12:00–12:02, CPX 12:02–12:10, post close to 13:00. Futures close-out day (quarterly): instruments in the futures close-out auction trade continuously 09:10–12:00, auction 12:00–12:15, continuous 12:15–16:50. Off-book trade reporting: 08:00–18:15. Auctions can be extended: market order extension 2 minutes, price monitoring extension 5 minutes (volatility auction 3 minutes); the closing auction can start up to 10 minutes early if a circuit breaker triggers. The JSE may change times. Conformance tests run in the Customer Test Service (CTS) environment, whose schedule may differ; use the timestamps of the client's own messages and the JSE's replies (for example rejects for "Session is closed") to establish what session was in force.

What each session allows:

- **Start of Trading**: no new orders or amendments, cancels allowed; only GTC/GTD orders from previous days are in the book. A New Order is rejected (observed code 9008 "Session is closed" or 134007 "Cannot submit/amend orders in session").
- **Opening, Intraday, Closing, Re-opening, Futures close-out Auction Calls**: orders collect and execute at the uncross at one price (volume maximising). IOC and FOK Market and Limit orders are rejected (code 1524 "Invalid TIF (not permitted during this session)"). Stop orders stay unelected until the end. No new pegged orders. Market order remainders expire after the uncross; OPG (opening) and ATC (closing) remainders expire; GFA remainders are parked or expire; GFX remainders expire after the intraday auction. OPG is accepted only in the opening auction (code 1507 otherwise).
- **Continuous Trading**: continuous matching; all order types; cross orders only here; circuit breakers apply.
- **Volatility Auction Call**: triggered by a circuit breaker, 5 minutes, auction rules as above.
- **Closing Price Publication (CPP, 2 minutes)**: no trading; cancels allowed; new orders with ATC, OPG, GFA, GFX, IOC, FOK are rejected; amendments to DAY, GTD, GTC, GTT, CPX orders are rejected (code 9015 "Instrument in Closing Price Publication session").
- **Closing Price Cross (CPX, 5–8 minutes)**: trades only at the published closing price. Limit orders priced better than the closing price are re-priced to it (Execution Report `D`); new limit orders priced worse are rejected (code 1207 "Invalid limit price (not equal to closing price)"); new stop orders and GFA, GFX, OPG, ATC orders are rejected; price amendments are rejected (code 3905).
- **Post Close**: cancels only; GTT orders expire at its start.
- **Halt** (manual): cancels only; orders stay in the book. **Pause** (manual): orders accepted but no executions. Orders for a halted or suspended instrument are rejected (code 9003).
