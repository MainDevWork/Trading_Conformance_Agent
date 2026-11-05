# Trading Conformance Automation and Reporting Framework

## Problem Statement

Trading Operations is responsible for overseeing and supporting client conformance testing to ensure that clients comply with the JSE's conformance standards before connecting their applications to the production trading and information environments.

Before a client can trade in the live market or consume production market data, they are required to demonstrate that their systems can interact correctly with the JSE's Trading and Information Services and behave in accordance with the relevant service specifications. Trading Operations is responsible for validating these outcomes and providing the necessary sign-off before clients can proceed to production.

To support this process, Trading Operations uses Vonnegut, a platform that captures and stores detailed message-level trading data. When a client submits an order using a specific CompID, every message associated with that activity can be viewed in Vonnegut, including the message type, submitted fields and system responses. Vonnegut provides visibility into the underlying message flow between client systems and the JSE. This detailed view is used to validate whether a client has successfully completed the required conformance scenarios.

Once a client has completed testing, Trading Operations generates a conformance report to determine whether all required test scenarios have been successfully executed. The report forms the basis for assessing whether a client has met the requirements to proceed towards production enablement.

While this process is effective in confirming that testing has taken place, significant manual effort is often required to confirm the outcome and provide final feedback to clients.

When a conformance report does not achieve a 100% pass rate, analysts frequently need to perform additional investigation to determine the root cause. This may involve reviewing message-level activity in Vonnegut, validating test scenarios, checking conformance configurations and manually interpreting report results before meaningful feedback can be provided to the client.

A further challenge is that report outcomes are not always aligned with the actual trading activity performed by the client. In some cases, the conformance report indicates that a test has failed, while manual verification of the underlying messages and trading activity shows that the client successfully completed the scenario. This requires additional investigation, manual validation and, in certain cases, adjustments to the conformance configuration before an accurate outcome can be established.

As a result, there is often considerable back-and-forth between Trading Operations and clients. Clients may believe they have completed all required testing, while Trading Operations must investigate exceptions, request additional information, require clients to perform retesting or manually verify the results before final sign-off can be provided. This increases turnaround times and can delay a client's readiness for production trading and market data consumption.

The process also relies on specialist knowledge accumulated over time regarding how conformance tests have been configured and maintained. Analysts frequently require support when reports do not produce the expected results or when test cases need to be reviewed and updated. This creates a key-person dependency, where a limited number of individuals possess the knowledge required to troubleshoot issues and validate outcomes, introducing operational risk. We will source our data from the Vonnegut system.

## Key Challenges

- Manual investigation is often required when conformance reports do not achieve a 100% pass rate.
- Report results may not always align with the actual client activity, requiring additional verification.
- The process relies on detailed knowledge of conformance test configurations and historical setup decisions.
- Analysts may struggle to determine why specific test cases failed.
- Significant back-and-forth communication with clients is often required before conformance can be completed.
- Visibility of overall conformance activity across clients, projects and testing initiatives is limited and largely maintained through manual processes.
- Measuring turnaround times, conformance volumes, pass rates and operational effort is difficult.

## Why We Chose This Problem

We selected this problem because it represents a real operational challenge experienced by Trading Operations and has a direct impact on clients, operational efficiency and the broader business.

This challenge extends beyond reporting. It affects the entire conformance process, from client testing and validation through to final client sign-off and production enablement.

When conformance assessments take longer than expected, clients may experience delays in completing onboarding activities and moving into production environments to begin trading and consuming market data. Improving this process therefore benefits both internal operations and the client experience.

We also chose this problem because it is highly measurable. The success of any improvement can be quantified through metrics such as:

- Number of clients completing conformance.
- Client pass and fail rates.
- Average turnaround time to complete conformance.
- Number of repeat investigations.
- Number of client follow-ups required.
- Conformance activity by project or functionality.
- Overall conformance volumes and trends.

Most importantly, addressing this problem has the potential to reduce manual effort, decrease dependency on specialist knowledge, improve operational visibility and create a more efficient and transparent conformance process for both Trading Operations and clients.

JSE Data & Digital Academy Final Case Study (Group 6)

Tshephang Tsheoga

Ndivhuwo Makhavhu

Sponsor: Head Trading Operations

Sixolisile Mahlasela
