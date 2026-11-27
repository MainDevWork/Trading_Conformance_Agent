# Trading Conformance Agent: project report

27/11/2026 · Tshephang Tsheoga and Ndivhuwo Makhavhu

## The problem

A JSE Trading Operations analyst takes about three days, sometimes more, to check one client's conformance test report by hand. A conformance test report is the client's record of the test steps in JSE Volume 202 that its trading system completed; the JSE signs it off before the client may connect to the live market.

Each test step takes an analyst an hour or more, for three reasons:

| Task done by hand | Why it takes time |
| --- | --- |
| Finding each step's FIX messages in Vonnegut, the JSE platform that captures every trading message by CompID (the identifier of a client's trading connection) | The analyst searches one test case at a time |
| Waiting for the IT department when Vonnegut fails | The check stops until IT fixes the fault |
| Sending queries to the client about the report | Each query waits for the client's reply |

The report's result is not always what the client's messages show: a step marked Fail can turn out to have been done correctly. Settling this needs knowledge of how each test is configured, which few analysts hold, so the check depends on those people being available.

The sponsor is the Head of Trading Operations. The project is the JSE Data & Digital Academy final case study of Group 6: Tshephang Tsheoga and Ndivhuwo Makhavhu.

## What we built

We built a web page with a chat agent that checks a client's conformance test report against the client's FIX messages and answers an analyst's questions about those messages in plain English. It runs at [maindevwork.github.io/Trading_Conformance_Agent](https://maindevwork.github.io/Trading_Conformance_Agent/). The data is real JSE conformance-testing messages from 01/07/2026 to 30/09/2026; every real CompID was replaced with a made-up one.

**1. Data preparation, in three layers.** Python scripts build each layer from the one before it and store it in a private cloud storage folder. The same cleaning was written a second time in T-SQL on Microsoft SQL Server, and a query compares the two sets of counts.

| Layer | What it holds |
| --- | --- |
| Bronze | The 36 Excel exports from Vonnegut, unchanged except for the CompIDs, plus one combined table per message type (11 types) |
| Silver | One cleaned table, one row per distinct message: repeated rows merged, missing CompIDs filled from related messages, client requests linked to the JSE order they refer to |
| Gold | A star schema (a table of events whose codes are explained in small lookup tables): 3 fact tables and 6 lookup tables, 9 in all |

**2. The page.** When the analyst enters the database key, the page downloads the 9 gold tables and loads them into DuckDB-WASM, a SQL database that runs inside the browser. File and network access for that database is then switched off.

**3. The report check.** The analyst attaches the client's Volume 202 report as Excel or PDF. The file is read in the browser and is not uploaded. With the first prompt, three SQL queries find every ID the client wrote, and a fixed rule for each test gives every step one result: Pass, Fail, Needs review, Not checkable or Not attempted. No language model decides a result. The page then writes an Excel report and a PDF assessment for the client.

**4. The agent.** For every other question, the page first runs summary queries for the CompIDs, months and reject codes the question names, then sends the question to the language model `nvidia/nemotron-3.5-lightning:free` through OpenRouter. The model can call 7 tools (9 with a report attached), such as `run_sql` for one SELECT query; it gets at most 12 rounds or 60 seconds. Answers that the report results alone settle, such as "what failed", are written by the page with no model request.

**5. Reference and memory.** 16 reference files taken from JSE Volumes 00E, 01E, 10, 201 and 202 give the model the rules, including all 714 Volume 10 reject codes. Conversations and memory notes are saved in the browser on that computer only.

The diagrams of each part are on the site: [system architecture](https://maindevwork.github.io/Trading_Conformance_Agent/Pages/system_architecture.html), [agent methodology](https://maindevwork.github.io/Trading_Conformance_Agent/Pages/agent_methodology.html), [data architecture](https://maindevwork.github.io/Trading_Conformance_Agent/Pages/data_architecture.html).

## What we measured

**Review time.** Checking one client report took about three days by hand and takes under 30 minutes with the agent. The page writes, under every answer, how long it took, how many requests the model received, and after how many seconds the first words appeared, so each review's time is recorded as it happens.

| Measure | By hand | With the agent |
| --- | --- | --- |
| Time to check one client report | About 3 days, sometimes more | Under 30 minutes |
| Time per test step | 1 hour or more | All steps checked by 3 SQL queries when the first prompt is sent |
| Work stopped by a Vonnegut fault | Until IT fixes it | None: the page uses the exported messages |
| Who decides a step's result | The analyst | A fixed rule per test; the analyst can change a result, and the report records the change |

Open question: how many reports were timed for the "under 30 minutes" figure, and which ones. The sample reports used were for the fictitious CompIDs IAIN01 and LCNN13 (first and second attempt).

**Data cleaning.** The 36 exports held 3,763,516 rows. Cleaning merged 1,593,696 repeated rows (42.3%), which left 2,169,820 distinct messages. The run of 01/11/2026 also gave 5,611 messages with no CompID a CompID from related messages, and linked 232,316 client requests to the JSE order they refer to. The T-SQL version on SQL Server was compared with the Python run by count.

| Message type | Export rows | Messages after cleaning | Share repeated |
| --- | ---: | ---: | ---: |
| Reject | 1,127,014 | 736,608 | 34.6% |
| Order Cancel/Replace Request | 929,951 | 558,305 | 40.0% |
| Execution Report | 699,162 | 245,298 | 64.9% |
| Order Cancel Request | 539,586 | 318,157 | 41.0% |
| New Order | 325,344 | 205,175 | 36.9% |
| Logon | 74,580 | 55,557 | 25.5% |
| Logon Response | 23,846 | 19,947 | 16.4% |
| Order Cancel Reject | 21,909 | 14,601 | 33.4% |
| Logout | 21,306 | 15,617 | 26.7% |
| Order Mass Cancel Report | 464 | 309 | 33.4% |
| Order Mass Cancel Request | 354 | 246 | 30.5% |
| **Total** | **3,763,516** | **2,169,820** | **42.3%** |

**Limits of the data.** The September 2026 export has no time in force or order quantity on new orders and no liquidity indicator on execution reports, so tests that need them get Needs review. Steps that use gateways whose messages are not exported (market data, Post Trade, Drop Copy, derivatives) get Not checkable.

## What it cost

The system runs at R0 a month on free plans. Its limit is the language model's 50 free requests a day, which one R169 purchase raises to 1,000. Amounts in rand use R16.93 to the US dollar, the rate on 16/11/2026.

| Item | Plan used | Cost now | Limit on that plan | Cost to lift the limit |
| --- | --- | ---: | --- | ---: |
| Language model `nvidia/nemotron-3.5-lightning:free` through OpenRouter | Free model | R0 | 20 requests a minute; 50 a day until the account has bought US$10 of credit | US$10 (R169), once: 1,000 requests a day |
| Cloud storage for the three data layers (Supabase) | Free | R0 | 1 GB of files, 5 GB of downloads a month; project paused after 1 week unused | Pro plan US$25 (R423) a month: 100 GB of files |
| Hosting of the page (GitHub Pages) | Free, public repository | R0 | None that applies | — |
| In-browser database (DuckDB-WASM) | Open source | R0 | Uses about 1.5 GB of the analyst's computer memory while the page is open | — |

One question can use up to 13 model requests (12 tool rounds and one final request), so 50 requests a day covers only a few report reviews. Answers that the report results alone settle use no request.

Open question: the hours we and the sponsor's team spent from 26/10/2026 to 20/11/2026, which the brief asks to be counted, and the size of the gold files, which each key entry downloads and which counts towards the 5 GB of downloads a month.

Prices as of 20/11/2026: [Supabase pricing](https://supabase.com/pricing), [OpenRouter limits](https://openrouter.ai/docs/api/reference/limits), [OFX USD to ZAR](https://www.ofx.com/en-us/exchange-rates/zar).

## What we learned

1. **A test result must come from a fixed rule, not from the model.** The same report checked twice gives the same results only because SQL and a written rule per test decide each step. The model explains results and answers questions; it does not set them.
2. **The exports repeat rows.** 42.3% of export rows were copies of another row, and 64.9% of Execution Report rows. Counts taken straight from the exports would overstate client activity by that much.
3. **The exports are not complete.** Some columns are empty in some months, and some gateways are not exported at all. The check has to say Needs review or Not checkable for those steps instead of Fail.
4. **Fictitious CompIDs have to be enforced by the scripts.** The bronze script stops without uploading a file if any real CompID is left in it, and the anonymising script stops on a CompID that is not in the key.
5. **Long requests give worse answers.** Published tests found that 10 of 12 models scored less than half their short-request score at 32,000 tokens (a token is about 4 characters). The page warns from 32,000 tokens and offers to continue in a new conversation that starts with a 300-word summary.
6. **Test on the live site, not only locally.** Windows treats `pages` and `Pages` as one folder name and GitHub Pages does not, so 6 of the 7 diagram links failed only on the live site. Opening the page as a file stops its scripts from running, so a local test needs a local web server.
7. **Office networks can hold back a streamed answer.** On one laptop the answer appeared only when complete, because a program such as an antivirus or a company proxy held the streamed reply.

## Moving to production

In production the system runs on the JSE's Microsoft Azure, under one JSE Azure subscription, in place of OpenRouter, Supabase and GitHub Pages, which are not on the list of approved platforms in the brief. The language model is deployed in Microsoft Foundry (formerly Azure AI Foundry), and each analyst gets one key through Azure API Management. The code base is kept in an Azure DevOps repository. Two copies of the agent are set up and tested. Analysts use the agent through a web application on Azure that only the team can open, or by opening the code base in Visual Studio on their own laptops.

The agent can get the FIX messages in two ways:

- **Upload an extract.** The analyst extracts the FIX messages from Vonnegut, as analysts do now, and uploads the extract to the agent in the same way as the client's conformance test report. The agent checks the report against the extract. This is the faster and cheaper way to start using the agent, but the analyst still makes the extract by hand.
- **Direct connection.** Vonnegut follows the OSI (Open Systems Interconnection) model, a standard set of layers for network communication. It receives FIX messages at the network layer as raw bits, and its own decoding code in the layers above turns them into the tables that the exports for this project came from. Trading Operations cannot provide that decoding code. The agent's code would therefore connect to the trading gateways through the IP network ports, capture the FIX messages as raw bits, and decode them into tables with its own decoding code. The decoded messages are stored in an Azure SQL Database, and the agent works from that database. This removes the manual extract, but it is a complex task, and it costs more and takes longer to build than uploading an extract.

**Estimated cost on Azure.** The Azure prices below are Microsoft's list prices in rand for the South Africa North region, taken from Microsoft's Azure Retail Prices API on 25/11/2026. They exclude VAT and any discount the JSE has with Microsoft. Monthly figures use 730 hours a month, the figure the Azure pricing calculator uses.

| Cost | Microsoft Azure service, or basis | Estimate |
| --- | --- | ---: |
| Database (two instances) | Azure SQL Database, Standard S2 | R3,583 a month |
| Language model | Microsoft Foundry, GPT-5 mini, Global Standard | R275 a month |
| One key per analyst, with a monthly token limit on each key | Azure API Management, Basic v2 | R2,501 a month |
| Hosting (two copies of the agent) | Azure App Service, Premium v3 P0v3, Linux | R2,349 a month |
| Code repository | Azure DevOps, Basic plan | R0 for up to 5 users |
| **Running cost** | | **R8,708 a month** |
| Development | One developer for 3 months (OfferZen 2026 salary data) | R144,600 once |
| **First year** | 12 months of running cost plus development | **R249,100** |

The language model cost assumes about 100 client conformance test reports a month, each checked with about 10 requests to the model of about 50,000 input tokens each (a token is a piece of a word, about 4 characters). That is 50 million tokens sent to the model and 2 million tokens written by it each month, at R4.1681 per million input tokens and R33.345 per million output tokens. The development cost uses OfferZen's 2026 average salary of R48,200 a month for a developer with four or more years of experience. It does not include writing the decoding code for the direct connection, which would add development time and cost. The price records and calculations are in Documents/Cost_Evidence.

Sources, as of 25/11/2026: [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/), [Azure API Management token limit policy](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy), [Azure DevOps pricing](https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/), [OfferZen developer salaries](https://www.offerzen.com/blog/software-developer-salary-south-africa).

Before going live, the system needs the ADA, security and legal reviews, and a trial with Trading Operations analysts on real client test reports, run alongside the manual review.
