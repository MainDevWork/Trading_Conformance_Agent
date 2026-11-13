// Checks a client's conformance test report (read by attachments.js) against the FIX messages in the gold tables.
// For each test step the client answered, the IDs the client wrote (order IDs, client order IDs, execution IDs) are
// looked up in fact_message, the messages of those orders are collected, and a rule for that test decides the result
// from what the messages show. Nothing here calls the language model: the results are worked out by these rules, and
// the model is given them to explain and discuss.

// The results a test step can get.
export const RESULTS = {
  PASS: "Pass",
  FAIL: "Fail",
  REVIEW: "Needs review",
  NOT_CHECKABLE: "Not checkable",
  NOT_ATTEMPTED: "Not attempted",
};

// Tests whose messages are not in the Trading FIX message data (see knowledge/tests.md).
const NOT_CHECKABLE = [
  [/^I\d/, "Market data tests use the market data services, whose messages are not in the exports."],
  [/^T(5|6|7|8)-/, "Trade reports and trade downloads go through the Post Trade Gateway, whose messages are not in the exports."],
  [/^T9-/, "Drop Copy Gateway messages are not in the exports."],
  [/^T11-/, "New Order Cross messages are not in the exports."],
  [/^T1[5-9]-/, "Derivatives tests use the Native Enhanced Gateway, whose messages are not in the exports."],
  [/^T3-01[12]$/, "Derivatives order types use the Native Enhanced Gateway, whose messages are not in the exports."],
  [/^T23-/, "Circuit breaker alerts go to the Drop Copy Gateway, whose messages are not in the exports."],
  [/^T24-/, "The FX auction uses the Native Heavy Gateway, whose messages are not in the exports."],
  [/^T3-01[45]$|^T25-002$/, "Self-match prevention on the FIX gateway: FIX gateway messages are not in the exports."],
  [/^T10-00[34]$/, "Trade reports by the CTA and News messages are not in the exports."],
  [/^T1[23]-00[23]$|^T20-003$/, "This step uses the Drop Copy or Post Trade Gateway, whose messages are not in the exports."],
  [/^T14-/, "Volume 00E v4.09 (28/05/2026) removed the EOD volume auction and GDX orders, and the September export has no time in force on new orders."],
  [/^G2-/, "Heartbeats and resend requests on the FIX gateways are not in the exports."],
];

// Tests checked from the client's session messages (logons, logouts, mass cancels) instead of order IDs.
const SESSION_TESTS = /^(T1-|G1-|T3-008$)/;

// The columns read for each message.
const MESSAGE_COLUMNS = `f.message_id, strftime(f.timestamp, '%Y-%m-%d %H:%M:%S.%g') AS time, f.comp_id, f.message_type,
  f.message_type_name, f.report_event, f.order_id, f.client_order_id, f.orig_client_order_id, f.execution_id,
  f.public_order_id, f.security_id, f.side_name, f.order_type, f.order_type_name, f.order_sub_type, f.time_in_force,
  f.time_in_force_name, f.order_quantity, f.display_quantity, f.limit_price, f.cancel_on_disconnect,
  f.self_trade_prevention_key, f.order_status_name, f.working_indicator, f.liquidity_indicator, f.executed_quantity,
  f.executed_price, f.reject_code, r.meaning AS reject_meaning, f.is_rejection, f.protocol_version, f.logout_reason,
  f.mass_cancel_status, f.mass_cancel_request_type`;

async function rows(conn, sql) {
  const table = await conn.query(`SELECT COLUMNS(*)::VARCHAR FROM (\n${sql}\n)`);
  const names = table.schema.fields.map((f) => f.name);
  return table.toArray().map((r) => Object.fromEntries(names.map((n) => [n, r[n] ?? null])));
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// "20260901-17:42:54", "SAST 2026-09-09 13:38:30" and "2026-09-01 17:42:54.251" are all read as local times.
export function parseTime(text) {
  const m = String(text || "").match(/(\d{4})-?(\d{2})-?(\d{2})[ T-]+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].slice(0, 3).padEnd(3, "0") : 0);
}
const pad = (n) => String(n).padStart(2, "0");
export const fmtDate = (d) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "");
export const fmtClock = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "");
const fmtGap = (ms) => {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s >= 86400) return `${Math.round(s / 86400)} day${s >= 129600 ? "s" : ""}`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
};

// What the client wrote in a test step's response columns, labelled values such as "OrderID:O0Sb…" and
// "SelfTradePreventionKey:eaeb…" separated from IDs to look up.
function readResponse(entry) {
  const text = [...entry.fields, entry.clientComment].join("\n");
  const labelled = [...text.matchAll(/([A-Za-z][A-Za-z ]{1,40}?)\s*[:=]\s*"?([A-Za-z0-9.\-]+)"?/g)]
    .map((m) => ({ label: m[1].trim(), value: m[2] }));
  const notIds = new Set(labelled.filter((p) => /self\s*trade|prevention|stp|trd\s*key|quantity|qty|type|status|indicator|price|instrument/i.test(p.label)).map((p) => p.value));
  const ids = new Set();
  for (const t of text.match(/[A-Za-z0-9]{6,}/g) || []) {
    if (!/\d/.test(t) || notIds.has(t)) continue;
    if (/^20\d{6}$/.test(t) || /^[A-Z]{4}\d{2}$/.test(t)) continue; // a date or a CompID
    ids.add(t);
  }
  const claims = labelled.filter((p) => !/order\s*id|exec(ution)?\s*id|cl(ient)?\s*ord/i.test(p.label));
  return { ids: [...ids].slice(0, 40), claims };
}

export function notCheckable(id) {
  for (const [pattern, reason] of NOT_CHECKABLE) if (pattern.test(id)) return reason;
  return null;
}

// The orders among a test's messages, each with its messages in time order.
function ordersOf(messages) {
  const byId = new Map();
  for (const m of messages) {
    if (!m.order_id) continue;
    if (!byId.has(m.order_id)) byId.set(m.order_id, { id: m.order_id, msgs: [] });
    byId.get(m.order_id).msgs.push(m);
  }
  // Order Cancel Rejects carry no order ID: they are matched to the order by the request's client order ID.
  const byRequest = new Map();
  for (const o of byId.values()) for (const m of o.msgs) if (m.client_order_id) byRequest.set(m.client_order_id, o);
  for (const m of messages) {
    if (!m.order_id && m.client_order_id && byRequest.has(m.client_order_id)) byRequest.get(m.client_order_id).msgs.push(m);
  }
  const orders = [...byId.values()];
  for (const o of orders) {
    o.msgs.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    o.new = o.msgs.find((m) => m.message_type === "D");
    const first = o.new || o.msgs[0];
    o.comp = first.comp_id;
    o.entered = parseTime(first.time);
    o.type = (o.new || o.msgs.find((m) => m.order_type))?.order_type || null;
    o.typeName = (o.new || o.msgs.find((m) => m.order_type_name))?.order_type_name || null;
    o.reports = o.msgs.filter((m) => m.message_type === "8");
    o.events = o.reports.map((m) => m.report_event);
    o.trades = o.reports.filter((m) => m.report_event === "Trade");
    o.cancelRejects = o.msgs.filter((m) => m.message_type === "9");
    // Rejections of the order itself; a rejected cancel or amend request (Order Cancel Reject) is in cancelRejects.
    o.rejections = o.msgs.filter((m) => m.is_rejection === "true" && m.message_type !== "9");
    o.requests = o.msgs.filter((m) => m.message_type === "F" || m.message_type === "G");
    const firstReport = o.reports[0];
    // Traded on entry: the first execution report is a trade, within 1 second of the new order.
    o.tradedOnEntry = Boolean(firstReport && firstReport.report_event === "Trade" &&
      (!o.entered || parseTime(firstReport.time) - o.entered <= 1000));
    o.has = (event) => o.events.includes(event);
    o.final = o.reports.length ? o.reports[o.reports.length - 1] : null;
    o.executed = o.trades.reduce((s, m) => s + (Number(m.executed_quantity) || 0), 0);
    o.display = o.new ? Number(o.new.display_quantity) || 0 : 0;
    o.stpKey = o.new?.self_trade_prevention_key || o.msgs.find((m) => m.self_trade_prevention_key)?.self_trade_prevention_key || null;
  }
  return orders.sort((a, b) => (a.entered || 0) - (b.entered || 0));
}

// One order in plain words, e.g. "Order O0Sb… (client order ID 5990…): limit order entered 17:42:54 on 01/09/2026.
// Execution reports: Trade, Filled 17:42:54."
function describeOrder(o) {
  const clientIds = [...new Set(o.msgs.map((m) => m.client_order_id).filter(Boolean))];
  const what = [o.typeName ? `${o.typeName.toLowerCase()} order` : "order", o.new?.side_name ? o.new.side_name.toLowerCase() : null]
    .filter(Boolean).join(", ");
  const parts = [`Order ${o.id} (client order ID ${clientIds.slice(0, 4).join(", ")}${clientIds.length > 4 ? ", …" : ""}; CompID ${o.comp}): ` +
    `${what}${o.new ? ` entered ${fmtClock(o.entered)} on ${fmtDate(o.entered)}` : `; its New Order message is not in the export`}` +
    `${o.stpKey ? `, self-trade prevention key ${o.stpKey}` : ""}.`];
  const steps = [];
  for (const m of o.msgs) {
    if (m === o.new) continue;
    const t = fmtClock(parseTime(m.time));
    let label;
    if (m.message_type === "8") label = `${m.report_event}${m.order_status_name && !m.report_event?.startsWith(m.order_status_name) ? ` (${m.order_status_name})` : ""}`;
    else if (m.message_type === "D") label = "another New Order with the same client order ID";
    else if (m.message_type === "G") label = "amend request";
    else if (m.message_type === "F") label = `cancel request${m.comp_id !== o.comp ? ` from CompID ${m.comp_id}` : ""}`;
    else label = m.message_type_name;
    if (m.is_rejection === "true") label += ` rejected, code ${m.reject_code}${m.reject_meaning ? ` "${m.reject_meaning}"` : ""}`;
    const last = steps[steps.length - 1];
    if (last && last.label === label && last.t === t) last.n++;
    else steps.push({ label, t, n: 1 });
  }
  if (steps.length) {
    const shown = steps.slice(0, 10).map((s) => `${s.label}${s.n > 1 ? ` ×${s.n}` : ""} ${s.t}`);
    parts.push(`Then: ${shown.join("; ")}${steps.length > 10 ? `; and ${steps.length - 10} more` : ""}.`);
  } else {
    parts.push("No execution report for it is in the export.");
  }
  return parts.join(" ");
}

function describeSession(msgs) {
  const lines = [];
  for (const m of msgs) {
    const t = `${fmtClock(parseTime(m.time))}`;
    if (m.message_type === "A") lines.push(`${t} Logon${m.protocol_version ? ` with protocol version ${m.protocol_version}` : ""}`);
    else if (m.message_type === "B") lines.push(`${t} Logon Response code ${m.reject_code ?? "?"}${m.reject_meaning ? ` "${m.reject_meaning}"` : ""}`);
    else if (m.message_type === "5") lines.push(`${t} Logout${m.logout_reason ? ` ("${m.logout_reason}")` : ""}`);
    else if (m.message_type === "q") lines.push(`${t} Order Mass Cancel Request`);
    else if (m.message_type === "r") lines.push(`${t} Order Mass Cancel Report, ${m.mass_cancel_status === "7" ? "accepted" : `rejected, code ${m.reject_code}`}`);
    else if (m.message_type === "3") lines.push(`${t} Reject, code ${m.reject_code}${m.reject_meaning ? ` "${m.reject_meaning}"` : ""}`);
    else if (m.message_type === "8") lines.push(`${t} Execution Report ${m.report_event} for order ${m.order_id}`);
  }
  // Repeated lines at the same second are shown once with a count.
  const out = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && last.l === l) last.n++; else out.push({ l, n: 1 });
  }
  const shown = out.slice(0, 14).map((x) => `${x.l}${x.n > 1 ? ` ×${x.n}` : ""}`);
  return shown.length ? `Session messages of the CompID: ${shown.join("; ")}${out.length > 14 ? `; and ${out.length - 14} more` : ""}.` : "";
}

const pass = (reason) => ({ result: RESULTS.PASS, reason });
const fail = (reason) => ({ result: RESULTS.FAIL, reason });
const review = (reason) => ({ result: RESULTS.REVIEW, reason });
const TYPE_NAMES = { 1: "market", 2: "limit", 3: "stop", 4: "stop limit", 50: "pegged", 51: "pegged limit" };

function wrongType(o, type) {
  if (o.type && o.type !== type) return fail(`The order was a ${TYPE_NAMES[o.type] || o.typeName} order; this test needs a ${TYPE_NAMES[type]} order.`);
  return null;
}
function rejected(o) {
  if (o.rejections.length) {
    const r = o.rejections[0];
    return fail(`The order was rejected with code ${r.reject_code}${r.reject_meaning ? ` ("${r.reject_meaning}")` : ""}.`);
  }
  return null;
}

// Each rule returns { result, reason } from ctx = { entry, orders, main, session, claims }. main is the first order.
const RULES = {
  "T1-001": logonRule(null),
  "T1-002": logonRule("2"),
  "T1-003": logonRule("3"),
  "T2-001": auctionRule("1"),
  "T2-002": auctionRule("2"),
  "T3-001": aggressiveRule("1"),
  "T3-002": aggressiveRule("2"),
  "T3-003": ({ main }) => wrongType(main, "2") || rejected(main) ||
    (main.tradedOnEntry ? fail("The order traded the moment it was entered, so it took liquidity; a passive order must rest in the order book first and trade later.")
      : main.has("New (accepted)") && main.trades.length ? pass(`The order was accepted, rested, and traded later at ${fmtClock(parseTime(main.trades[0].time))}.`)
      : main.has("New (accepted)") && (main.has("Cancelled") || main.has("Expired")) ? fail("The order was accepted and rested but never traded: it ended cancelled or expired. A passive order must be matched.")
      : review("The order was accepted, but no trade on it is in the export.")),
  "T3-004": stopRule("3"),
  "T3-005": stopRule("4"),
  "T3-006": amendRule,
  "T3-007": ({ main }) => {
    const rej = main.cancelRejects[0];
    if (rej) return fail(`The cancel request was rejected with code ${rej.reject_code}${rej.reject_meaning ? ` ("${rej.reject_meaning}")` : ""}.`);
    if (main.has("Cancelled") && main.requests.some((m) => m.message_type === "F")) return pass("The client sent a cancel request and the order was cancelled.");
    if (main.has("Cancelled")) return review("The order was cancelled, but the client's cancel request is not in the export.");
    return review("No cancellation of the order is in the export.");
  },
  "T3-008": ({ session }) => {
    const reports = session.filter((m) => m.message_type === "r");
    if (reports.some((m) => m.mass_cancel_status === "7")) {
      const cancelled = session.filter((m) => m.message_type === "8" && m.report_event === "Cancelled").length;
      return pass(`An Order Mass Cancel Request was accepted${cancelled ? ` and ${cancelled} orders were cancelled` : ""}.`);
    }
    if (reports.length) return fail(`The Order Mass Cancel Request was rejected with code ${reports[0].reject_code}.`);
    return review("No Order Mass Cancel Request from this CompID is in the export within 10 minutes of the test time.");
  },
  "T3-009": ({ orders }) => {
    const expired = orders.filter((o) => o.final?.report_event === "Expired");
    const cancelled = orders.filter((o) => o.final?.report_event === "Cancelled");
    const noCod = orders.filter((o) => o.new && o.new.cancel_on_disconnect === "0");
    if (noCod.length) return fail(`${noCod.length} of the orders were entered without cancel on disconnect.`);
    if (expired.length === orders.length) return pass(`${orders.length === 1 ? "The order" : `All ${orders.length} orders`} expired when the session ended, as a cancel on disconnect does.`);
    if (cancelled.length) return fail(`${cancelled.length} of the ${orders.length} orders ended cancelled, not expired: a cancel on disconnect gives the status Expired.`);
    return review(`${expired.length} of the ${orders.length} orders ended expired; the others have no expiry in the export.`);
  },
  "T3-013": (ctx) => (/iceberg/i.test(ctx.entry.title) ? icebergRule(ctx) : selfMatchRule(ctx)),
  "T3-016": amendRule,
  "T4-001": ({ orders, session }) => {
    const code100 = session.some((m) => m.message_type === "B" && m.reject_code === "100");
    return review(`The ${orders.length} orders are in the export${session.length ? ", with the logons and logouts listed" : ""}. ` +
      "Recovery channel messages are not exported, so whether the missed messages were recovered cannot be seen." +
      (code100 ? " A Logon Response with code 100 shows a logon to the recovery channel before the real-time channel." : ""));
  },
  "T10-001": ({ main }) => {
    if (!main.has("Cancelled")) return review("No cancellation of the order is in the export.");
    if (main.requests.some((m) => m.message_type === "F" && m.comp_id === main.comp)) return fail("The client sent the cancel request itself; this test needs the CTA to cancel the order.");
    return pass("The order was cancelled with no cancel request from the client, as a cancellation by the CTA is.");
  },
  "T10-002": ({ main }) => (main.reports.some((m) => m.report_event === "Trade Cancel")
    ? pass("A Trade Cancel execution report is in the export.")
    : review("No Trade Cancel execution report for the order is in the export.")),
  "T12-001": peggedRule("50"),
  "T13-001": peggedRule("51"),
  "T20-001": (ctx) => icebergRule(ctx),
  "T20-002": ({ main }) => {
    if (!main.trades.length) return review("No trade on the order is in the export.");
    const refills = main.reports.filter((m) => m.report_event === "Restated").length;
    if (main.display && (main.executed > main.display || refills)) {
      return pass(`The order traded ${main.executed} in total against a display quantity of ${main.display}${refills ? `, with ${refills} refills of the displayed part` : ""}, so trades reached its hidden part.`);
    }
    return review("The order traded, but nothing in the export shows trades reaching its hidden part.");
  },
  "T21-001": ({ orders }) => {
    const traded = orders.filter((o) => o.trades.length);
    if (!traded.length) return review("None of the orders traded, so no liquidity indicator can be shown.");
    const values = traded.flatMap((o) => o.trades.map((m) => m.liquidity_indicator)).filter(Boolean);
    if (values.length) {
      return values.every((v) => v === "1" || v === "2") ? pass(`The trades carry liquidity indicator ${[...new Set(values)].join(" and ")}.`)
        : fail(`The trades carry liquidity indicator ${[...new Set(values)].join(", ")}; the test needs 1 or 2.`);
    }
    const inferred = traded.map((o) => `${o.id} ${o.tradedOnEntry ? "traded when entered (would be 2, removed liquidity)" : "rested, then traded (would be 1, added liquidity)"}`);
    return review(`This month's export has no liquidity indicator on execution reports. From the timing: ${inferred.join("; ")}.`);
  },
  "T22-001": ({ main }) => {
    const accepted = main.reports.find((m) => m.report_event === "New (accepted)");
    if (!accepted) return review("No New (accepted) execution report for the order is in the export.");
    const wi = accepted.working_indicator;
    if (wi === "1" || wi === "2") return pass(`The order was accepted with working indicator ${wi}.`);
    return fail(`The order was accepted with working indicator ${wi ?? "empty"}; the test needs 1 or 2.`);
  },
  "T25-001": (ctx) => selfMatchRule(ctx),
  "G1-001": ({ session }) => {
    const codes = session.filter((m) => m.message_type === "B").map((m) => m.reject_code);
    if (codes.includes("626") && codes.lastIndexOf("0") > codes.indexOf("626")) return pass("A logon was refused while the CompID was suspended (code 626), then a later logon was accepted.");
    return review("No refused logon with code 626 followed by an accepted logon is in the export near the test time.");
  },
  "OT1-001": ({ main }) => {
    const other = main.requests.find((m) => m.message_type === "F" && m.comp_id !== main.comp);
    if (other && main.has("Cancelled")) return pass(`CompID ${other.comp_id} cancelled the order entered by ${main.comp}.`);
    return review("No cancellation of the order from another CompID is in the export.");
  },
};

function logonRule(version) {
  return ({ session }) => {
    const logons = session.filter((m) => m.message_type === "A");
    const replies = session.filter((m) => m.message_type === "B");
    if (!logons.length && !replies.length) return review("No logon by this CompID is in the export within 10 minutes of the test time.");
    if (version && !logons.some((m) => m.protocol_version === version)) {
      return fail(`The logons used protocol version ${[...new Set(logons.map((m) => m.protocol_version))].join(", ") || "unknown"}; this test needs version ${version}.`);
    }
    if (replies.some((m) => m.reject_code === "0")) return pass(`The CompID logged on${version ? ` with protocol version ${version}` : ""} and the logon was accepted (Logon Response code 0).`);
    return fail(`Every logon was refused: Logon Response codes ${[...new Set(replies.map((m) => m.reject_code))].join(", ")}.`);
  };
}

function auctionRule(type) {
  return ({ main }) => wrongType(main, type) || rejected(main) ||
    (main.tradedOnEntry ? fail("The order traded the moment it was entered, which happens in continuous trading. In an auction an order rests until the uncross.")
      : main.has("New (accepted)") && main.trades.length ? pass(`The order was accepted, rested, and traded at ${fmtClock(parseTime(main.trades[0].time))}, after it was entered, as at an auction uncross.`)
      : main.has("New (accepted)") ? review("The order was accepted, but no trade at an uncross is in the export.")
      : review("No execution report for the order is in the export."));
}

function aggressiveRule(type) {
  return ({ main }) => wrongType(main, type) || rejected(main) ||
    (main.tradedOnEntry ? pass("The order traded the moment it was entered, so it took liquidity. (The September export has no time in force on new orders, so IOC or FOK cannot be confirmed.)")
      : main.has("New (accepted)") ? fail("The order rested in the order book instead of trading when it was entered, so it was not aggressive.")
      : review("No execution report for the order is in the export."));
}

function stopRule(type) {
  return ({ main }) => wrongType(main, type) || rejected(main) ||
    (main.has("Triggered") && main.trades.length ? pass("The stop order was accepted, triggered when the stop price was reached, and traded.")
      : main.has("Triggered") ? review("The stop order was triggered, but no trade is in the export.")
      : review("No trigger of the stop order is in the export."));
}

function peggedRule(type) {
  return ({ main }) => wrongType(main, type) || rejected(main) ||
    (main.has("New (accepted)") ? pass(`The ${TYPE_NAMES[type]} order was accepted.`) : review("No acceptance of the order is in the export."));
}

function amendRule({ main }) {
  const rej = main.cancelRejects[0];
  if (rej) return fail(`An amend request was rejected with code ${rej.reject_code}${rej.reject_meaning ? ` ("${rej.reject_meaning}")` : ""}.`);
  if (main.has("Amended") || main.has("Amended or Restated")) return pass("The client sent an amend request and the order was amended.");
  return review("No amendment of the order is in the export.");
}

function icebergRule({ main }) {
  const rej = rejected(main);
  if (rej) return rej;
  if (!main.display) return review("The new order has no display quantity, so it is not shown to be an iceberg order.");
  const quantity = Number(main.new?.order_quantity) || 0;
  const refills = main.reports.filter((m) => m.report_event === "Restated").length;
  if (quantity > main.display) return pass(`The order was entered with order quantity ${quantity} and display quantity ${main.display}.`);
  if (main.executed > main.display || refills) {
    return pass(`The order was entered with display quantity ${main.display} and traded ${main.executed} in total${refills ? `, with ${refills} refills` : ""}, so it held a hidden part. (The September export has no order quantity on new orders.)`);
  }
  return review(`The order has display quantity ${main.display}, but the export does not show an order quantity above it.`);
}

function selfMatchRule({ orders }) {
  const keyed = orders.filter((o) => o.stpKey);
  if (keyed.length < 2) return review("The export does not hold two orders of the CompID with the same self-trade prevention key for this test.");
  const [resting, aggressor] = keyed;
  const at = aggressor.entered;
  const sameMoment = (m) => at && Math.abs(parseTime(m.time) - at) <= 1000;
  if (resting.trades.some(sameMoment) && aggressor.trades.some(sameMoment)) {
    return fail(`Both orders carry the key ${resting.stpKey} and both traded at ${fmtClock(at)}, when the second order was entered: the self-match was not prevented.`);
  }
  const stopped = resting.reports.find((m) => sameMoment(m) && (m.report_event === "Cancelled" || m.report_event === "Expired"));
  if (stopped) return pass(`When the second order with key ${resting.stpKey} was entered, the resting order was ${stopped.report_event.toLowerCase()} instead of trading with it.`);
  return review("The orders carry the same key, but the export does not show the resting order being cancelled when the second order was entered.");
}

// What each rule in RULES checks, in words, for the assessment PDF (client_report.js): the request the client had to
// send, the response the gateway had to return, the criteria the rule applies, and what to redo after a failure.
// Change the text here whenever a rule above changes.
const order = (type, when) => ({
  request: `A New Order with order type ${type}${when ? ` ${when}` : ""}, sent by the CompID in the report.`,
});
const CRITERIA = {
  logon: (version) => ({
    request: `A Logon message from the CompID${version ? ` with protocol version ${version}` : ""} near the test time in the report.`,
    response: "A Logon Response from the gateway.",
    criteria: `Logon messages of the CompID within 10 minutes of the test time${version ? `; at least one with protocol version ${version}` : ""}; a Logon Response with code 0 (accepted).`,
    redo: `Log on again${version ? ` with protocol version ${version}` : ""} and record the time of the accepted logon.`,
  }),
  auction: (type) => ({
    ...order(`${type} (${TYPE_NAMES[type]})`, "during the opening or closing auction"),
    response: "An accepted (New) Execution Report, then a trade Execution Report at the uncross.",
    criteria: `New Order: order type ${type}; not rejected; no trade within 1 second of entry (an order in an auction rests until the uncross). Execution Reports: New (accepted), then a trade later.`,
    redo: `Enter a ${TYPE_NAMES[type]} order during an auction and capture the accepted and uncross trade Execution Reports.`,
  }),
  aggressive: (type) => ({
    ...order(`${type} (${TYPE_NAMES[type]})`, "with time in force IOC or FOK during continuous trading"),
    response: "A trade Execution Report when the order is entered.",
    criteria: `New Order: order type ${type}; not rejected. The first Execution Report is a trade, within 1 second of the New Order. An order that rests in the order book fails.`,
    redo: `Repeat with an executable ${TYPE_NAMES[type]} order using IOC or FOK and capture the matching trade Execution Report.`,
  }),
  stop: (type) => ({
    ...order(`${type} (${TYPE_NAMES[type]})`),
    response: "An accepted Execution Report, a Triggered Execution Report when the stop price is reached, then a trade.",
    criteria: `New Order: order type ${type}; not rejected. Execution Reports: Triggered, then a trade.`,
    redo: `Repeat the ${TYPE_NAMES[type]} order so that the stop price is reached, and capture the Triggered and trade Execution Reports.`,
  }),
  pegged: (type) => ({
    ...order(`${type} (${TYPE_NAMES[type]})`, "during continuous trading"),
    response: "An accepted (New) Execution Report.",
    criteria: `New Order: order type ${type}; not rejected; a New (accepted) Execution Report for the order.`,
    redo: `Repeat the ${TYPE_NAMES[type]} order and capture its accepted Execution Report.`,
  }),
  amend: {
    request: "An order resting in the order book, then an Order Cancel/Replace Request changing its price or quantity.",
    response: "An Amended Execution Report for the same order.",
    criteria: "No Order Cancel Reject for the request; an Amended Execution Report for the order.",
    redo: "Repeat the amendment on a resting order and capture the Amended Execution Report.",
  },
  iceberg: {
    request: "A New Order with a display quantity above 0 and below its order quantity, during continuous trading.",
    response: "An accepted Execution Report; trades and refills of the displayed part.",
    criteria: "Not rejected; display quantity above 0; order quantity above the display quantity, or total traded quantity above the display quantity, or at least one refill (Restated Execution Report).",
    redo: "Repeat with an order quantity above the display quantity and capture the accepted Execution Report.",
  },
  selfMatch: {
    request: "A resting order with a self-trade prevention key, then a second order from the same CompID with the same key that would match it.",
    response: "The resting order cancelled or expired when the second order is entered, with no trade between the two.",
    criteria: "Two orders of the CompID with the same key. Within 1 second of the second order the resting order is Cancelled or Expired, and the two orders do not both trade at that moment.",
    redo: "Repeat with the same self-trade prevention key on both orders, logged on with protocol version 3.",
  },
};
const CRITERIA_OF = {
  "T1-001": CRITERIA.logon(null), "T1-002": CRITERIA.logon("2"), "T1-003": CRITERIA.logon("3"),
  "T2-001": CRITERIA.auction("1"), "T2-002": CRITERIA.auction("2"),
  "T3-001": CRITERIA.aggressive("1"), "T3-002": CRITERIA.aggressive("2"),
  "T3-003": {
    ...order("2 (limit)", "during continuous trading, without IOC or FOK"),
    response: "An accepted (New) Execution Report, then a later trade Execution Report for the same order.",
    criteria: "New Order: order type 2; not rejected; no trade within 1 second of entry. Execution Reports: New (accepted), then a trade later. Ending Cancelled or Expired without a trade fails.",
    redo: "Repeat during continuous trading so the order rests, then is matched; capture both the accepted and the trade Execution Reports.",
  },
  "T3-004": CRITERIA.stop("3"), "T3-005": CRITERIA.stop("4"),
  "T3-006": CRITERIA.amend, "T3-016": CRITERIA.amend,
  "T3-007": {
    request: "An order resting in the order book, then an Order Cancel Request for it.",
    response: "A Cancelled Execution Report for the same order.",
    criteria: "No Order Cancel Reject for the request; an Order Cancel Request from the client and a Cancelled Execution Report for the order.",
    redo: "Repeat the cancellation on a resting order and capture the Cancelled Execution Report.",
  },
  "T3-008": {
    request: "An Order Mass Cancel Request from the CompID near the test time in the report.",
    response: "An Order Mass Cancel Report, and a Cancelled Execution Report for each order cancelled.",
    criteria: "An Order Mass Cancel Report with status 7 (accepted) within 10 minutes of the test time.",
    redo: "Enter non-executable orders, send the Order Mass Cancel Request and capture the accepted Order Mass Cancel Report.",
  },
  "T3-009": {
    request: "Orders entered with cancel on disconnect set to 1, then the connection dropped.",
    response: "An Expired Execution Report for each order after the disconnect.",
    criteria: "Every order entered with cancel on disconnect 1; every order ends Expired. A cancel on disconnect gives Expired, not Cancelled.",
    redo: "Repeat with cancel on disconnect set on every order, drop the connection, log on again and capture the Expired Execution Reports.",
  },
  "T3-013": CRITERIA.selfMatch, "T25-001": CRITERIA.selfMatch,
  "T4-001": {
    request: "Orders entered, a disconnect, then logons to the real-time and recovery channels with the same CompID and a request for the missed messages.",
    response: "The missed messages, sent on the recovery channel.",
    criteria: "The orders, logouts and logons are in the exported messages. Recovery channel messages are not exported, so a JSE analyst decides whether the missed messages were recovered.",
    redo: "Supply the recovery channel log showing the Missed Message Request and its acknowledgement.",
  },
  "T10-001": {
    request: "An order resting in the order book, cancelled by the JSE Market Operations (CTA).",
    response: "A Cancelled Execution Report with no Order Cancel Request from the client.",
    criteria: "A Cancelled Execution Report for the order and no Order Cancel Request from the client's CompID.",
    redo: "Repeat with the CTA cancelling the resting order; the client must not send a cancel request.",
  },
  "T10-002": {
    request: "An order that trades, then the CTA cancels the trade.",
    response: "A Trade Cancel Execution Report for the trade.",
    criteria: "A Trade Cancel Execution Report for the order.",
    redo: "Repeat with the CTA cancelling the trade and capture the Trade Cancel Execution Report.",
  },
  "T12-001": CRITERIA.pegged("50"), "T13-001": CRITERIA.pegged("51"),
  "T20-001": CRITERIA.iceberg,
  "T20-002": {
    request: "An iceberg order, and another order that trades through its displayed and hidden parts.",
    response: "Trade Execution Reports on the iceberg order, with refills of the displayed part.",
    criteria: "Trades on the order; total traded quantity above the display quantity, or at least one refill (Restated Execution Report).",
    redo: "Repeat with an aggressive order larger than the displayed part and capture the trade and refill Execution Reports.",
  },
  "T21-001": {
    request: "An order during continuous trading that is partly or fully filled.",
    response: "Trade Execution Reports carrying the liquidity indicator.",
    criteria: "Each trade Execution Report carries liquidity indicator 1 (added liquidity) or 2 (removed liquidity).",
    redo: "Repeat with an order that trades and capture the trade Execution Reports with the liquidity indicator.",
  },
  "T22-001": {
    request: "A New Order during continuous trading that is accepted as New, sent by the CompID in the report.",
    response: "An accepted (New) Execution Report carrying the working indicator.",
    criteria: "The New (accepted) Execution Report of the order carries working indicator 1 or 2. An empty working indicator fails.",
    redo: "Repeat and capture the accepted Execution Report with the working indicator.",
  },
  "G1-001": {
    request: "Logons while the CompID is suspended, then after it is reinstated.",
    response: "Logon Responses from the gateway.",
    criteria: "Within 10 minutes of the test time: a logon refused with code 626 (CompID suspended), then a later logon accepted with code 0.",
    redo: "Repeat the suspended logon and the logon after reinstatement, and record the test time.",
  },
  "OT1-001": {
    request: "An order entered by one CompID, then an Order Cancel Request for it from another CompID of the same firm.",
    response: "A Cancelled Execution Report for the order.",
    criteria: "An Order Cancel Request from a CompID other than the one that entered the order, and a Cancelled Execution Report.",
    redo: "Repeat with the second CompID cancelling the first CompID's resting order.",
  },
};

// The criteria of a test step: { request, response, criteria, redo }.
export function criteriaFor(r) {
  if (r.id === "T3-013" && /iceberg/i.test(r.title)) return CRITERIA.iceberg;
  return CRITERIA_OF[r.id] || {
    request: "The messages of the test step as described in Volume 202.",
    response: "The gateway's responses to those messages.",
    criteria: "There is no automatic check for this test; a JSE analyst assesses the messages found.",
    redo: "Repeat the test step and record the IDs of its messages in the report.",
  };
}

// The columns of fact_message that hold an ID a client can write in a report.
const ID_COLUMNS = ["order_id", "execution_id", "client_order_id", "orig_client_order_id", "public_order_id"];

const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${fmtClock(d)}`;

// Adds a value to the list kept under a key of a Map.
const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

// Checks every test step of a report. Returns { file, kind, checkedAt, compids, results, counts, overall,
// mandatoryMissing }. Each result is the test step from the report plus result, reason, shows (what the messages
// show, in plain words), idsGiven, idsFound, idsMissing, timeNote and messages (the messages found).
// Speed: fact_message has about 2.2 million rows, and a query that filters on these columns reads the whole table
// once. So the whole report is checked with three queries, however many test steps it has: one for every ID of every
// step, one for the messages of the orders found, and one for the session messages of every logon and mass cancel
// step. The rows returned are then sorted into the steps with lookup tables (Map objects) keyed by step, order ID
// and client order ID, instead of filtering every row again for each step.
export async function checkReport(store, report, onStep = () => {}) {
  const conn = store.conn;
  store.knownCompids ??= new Set((await rows(conn, "SELECT comp_id FROM dim_compid")).map((r) => r.comp_id));
  const known = store.knownCompids;
  const results = report.tests.map((t, i) => ({ ...t, key: i, ...readResponse(t) }));
  for (const r of results) {
    r.answered = Boolean(r.compid || r.time || r.fields.length);
    r.reportTime = parseTime(r.time);
  }

  // 1. Every ID of every answered test step, looked up in the five ID columns in one reading of fact_message.
  onStep("Looking up the IDs in the report");
  const stepsOfId = new Map();
  for (const r of results) if (r.answered) for (const v of r.ids) push(stepsOfId, v, r.key);
  const hits = [];
  if (stepsOfId.size) {
    const list = [...stepsOfId.keys()].map(quote).join(", ");
    const found = await rows(conn, `SELECT message_id, ${ID_COLUMNS.join(", ")} FROM fact_message
      WHERE ${ID_COLUMNS.map((c) => `${c} IN (${list})`).join(" OR ")}`);
    const seen = new Set();
    for (const m of found) {
      for (const c of ID_COLUMNS) {
        for (const k of stepsOfId.get(m[c]) || []) {
          const id = `${k}|${m[c]}|${m.message_id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          hits.push({ k, v: m[c], message_id: m.message_id, order_id: m.order_id, client_order_id: m.client_order_id });
        }
      }
    }
  }

  // 2. All messages of the orders found, plus the messages found directly (such as a rejected new order, which has
  // no order ID) and Order Cancel Rejects of the orders' requests.
  onStep("Collecting the messages of the orders");
  const messageIds = [...new Set(hits.map((h) => h.message_id))];
  const orderIds = [...new Set(hits.map((h) => h.order_id).filter(Boolean))];
  const messages = new Map();
  for (let i = 0; i < Math.max(messageIds.length, orderIds.length); i += 500) {
    const mIds = messageIds.slice(i, i + 500), oIds = orderIds.slice(i, i + 500);
    if (!mIds.length && !oIds.length) break;
    const where = [mIds.length ? `f.message_id IN (${mIds.join(", ")})` : null,
                   oIds.length ? `f.order_id IN (${oIds.map(quote).join(", ")})` : null,
                   oIds.length ? `(f.message_type IN ('9', '3') AND f.order_id IS NULL AND f.client_order_id IN (SELECT client_order_id FROM fact_message WHERE order_id IN (${oIds.map(quote).join(", ")})))` : null]
      .filter(Boolean).join(" OR ");
    for (const m of await rows(conn, `SELECT ${MESSAGE_COLUMNS} FROM fact_message f LEFT JOIN dim_reject_code r USING (reject_code) WHERE ${where}`)) messages.set(m.message_id, m);
  }
  // Lookup tables: each step's messages are taken by key instead of by reading every message again.
  const hitsOfStep = new Map();
  for (const h of hits) push(hitsOfStep, h.k, h);
  const messagesOfOrder = new Map();
  const noOrderByClientId = new Map();
  for (const m of messages.values()) {
    if (m.order_id) push(messagesOfOrder, m.order_id, m);
    else if (m.client_order_id) push(noOrderByClientId, m.client_order_id, m);
  }

  onStep("Checking each test against the messages");
  const prepared = [];
  for (const r of results) {
    const own = hitsOfStep.get(r.key) || [];
    r.idsGiven = r.ids;
    const found = new Set(own.map((h) => h.v));
    r.idsFound = [...found];
    r.idsMissing = r.ids.filter((v) => !found.has(v));
    const picked = new Map();
    const clientIds = new Set();
    for (const h of own) if (messages.has(h.message_id)) picked.set(h.message_id, messages.get(h.message_id));
    for (const o of new Set(own.map((h) => h.order_id).filter(Boolean))) {
      for (const m of messagesOfOrder.get(o) || []) {
        picked.set(m.message_id, m);
        if (m.client_order_id) clientIds.add(m.client_order_id);
      }
    }
    for (const c of clientIds) for (const m of noOrderByClientId.get(c) || []) picked.set(m.message_id, m);
    r.messages = [...picked.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    r.session = [];
    const p = prepare(r, known);
    if (p) prepared.push([r, p]);
  }

  // 3. The session messages (logons, logouts, mass cancels) of every step that needs them, in one query.
  const windows = prepared.filter(([, p]) => p.window);
  if (windows.length) {
    onStep("Reading the logon and mass cancel messages");
    const where = windows.map(([, p]) => `(f.comp_id = ${quote(p.window.comp)} AND f.timestamp BETWEEN '${iso(p.window.from)}' AND '${iso(p.window.to)}')`).join(" OR ");
    const session = await rows(conn, `SELECT ${MESSAGE_COLUMNS} FROM fact_message f LEFT JOIN dim_reject_code r USING (reject_code)
      WHERE (${where})
        AND (f.message_type IN ('A', 'B', '5', 'q', 'r', '3') OR (f.message_type = '8' AND f.report_event IN ('Cancelled', 'Expired')))
      ORDER BY f.timestamp, f.message_id`);
    const at = new Map(session.map((m) => [m, parseTime(m.time)]));
    for (const [r, p] of windows) {
      const { comp, from, to } = p.window;
      r.session = session.filter((m) => m.comp_id === comp && at.get(m) >= from && at.get(m) <= to).slice(0, 300);
    }
  }

  for (const [r, p] of prepared) finish(r, p, known);
  for (const r of results) delete r.ids;

  const counts = Object.fromEntries(Object.values(RESULTS).map((v) => [v, results.filter((r) => r.result === v).length]));
  const mandatoryMissing = results.filter((r) => r.result === RESULTS.NOT_ATTEMPTED && /^y/i.test(r.mandatory) &&
    !/^y/i.test(r.exemption) && /^(all|equity)/i.test(r.market) && !/n\/a|not supported|not applicable/i.test(r.clientComment));
  const overall = counts[RESULTS.FAIL] ? "Not passed"
    : counts[RESULTS.REVIEW] ? "Needs analyst review"
    : counts[RESULTS.PASS] ? "Passed, for the tests the exported messages can check"
    : "Nothing to check";
  const compids = [...new Set(results.map((r) => r.compid).filter(Boolean))];
  return { file: report.name, kind: report.kind, checkedAt: new Date(), compids, results, counts, overall, mandatoryMissing };
}

// The first part of checking one step: the result of a step with no response or with no exported messages, or else
// the step's orders and the time window of the session messages it needs. Returns null when the result is already set.
function prepare(r, known) {
  if (!r.answered) {
    r.result = RESULTS.NOT_ATTEMPTED;
    r.reason = r.clientComment ? `The client wrote: "${r.clientComment}".` : "The client gave no response for this step.";
    r.shows = "";
    return null;
  }
  const reason = notCheckable(r.id);
  if (reason) {
    r.result = RESULTS.NOT_CHECKABLE;
    r.reason = reason;
    r.shows = "";
    r.messages = [];
    return null;
  }
  const orders = ordersOf(r.messages);
  const clientOrders = orders.filter((o) => !r.compid || o.comp === r.compid);
  const main = clientOrders[0] || orders[0];

  // The session messages of the CompID within 10 minutes of the test time, or of the orders.
  let window = null;
  const compid = r.compid && known.has(r.compid) ? r.compid : main?.comp;
  const times = [r.reportTime, ...orders.flatMap((o) => o.msgs.map((m) => parseTime(m.time)))].filter(Boolean);
  if (compid && times.length && (SESSION_TESTS.test(r.id) || /^T(3-009|4-001)$/.test(r.id))) {
    const around = SESSION_TESTS.test(r.id) && r.reportTime ? [r.reportTime] : times;
    window = { comp: compid, from: new Date(Math.min(...around) - 10 * 60_000), to: new Date(Math.max(...around) + 10 * 60_000) };
  }
  return { orders, clientOrders, main, window };
}

// The second part: the rule for the test decides the result from the step's orders and session messages.
function finish(r, { orders, clientOrders, main }, known) {
  const notes = [];
  let verdict;
  if (r.compid && !known.has(r.compid) && !orders.length) {
    verdict = review(`CompID ${r.compid} sent no messages in the exports of July to September 2026.`);
  } else if (!SESSION_TESTS.test(r.id) && !r.idsGiven.length) {
    verdict = review("The report gives no order, client order or execution IDs, so the messages of this test cannot be found.");
  } else if (!SESSION_TESTS.test(r.id) && !orders.length) {
    verdict = review(`None of the IDs in the report (${r.idsGiven.slice(0, 6).join(", ")}${r.idsGiven.length > 6 ? ", …" : ""}) are in the exported messages. Either the IDs are wrong or the messages were not captured in the export.`);
  } else if (r.compid && main && !clientOrders.length) {
    verdict = fail(`The report gives CompID ${r.compid}, but the orders with these IDs were sent by CompID ${[...new Set(orders.map((o) => o.comp))].join(", ")}.`);
  } else {
    const rule = RULES[r.id];
    verdict = rule ? rule({ entry: r, orders: clientOrders, main, session: r.session, claims: r.claims })
      : review("There is no automatic check for this test; the messages found are described.");
  }

  // The test time in the report against the time of the nearest message.
  const msgTimes = [...r.messages, ...r.session].map((m) => parseTime(m.time)).filter(Boolean);
  if (r.reportTime && msgTimes.length) {
    const nearest = msgTimes.reduce((a, b) => (Math.abs(b - r.reportTime) < Math.abs(a - r.reportTime) ? b : a));
    const gap = nearest - r.reportTime;
    r.messageTime = nearest;
    if (Math.abs(gap) > 5 * 60_000) {
      notes.push(fmtDate(nearest) !== fmtDate(r.reportTime)
        ? `The report's test date ${fmtDate(r.reportTime)} differs from the messages' date ${fmtDate(nearest)}.`
        : `The report's test time ${fmtClock(r.reportTime)} is ${fmtGap(gap)} from the nearest message (${fmtClock(nearest)}).`);
      if (verdict.result === RESULTS.PASS) verdict = review(`${verdict.reason} The messages pass, but the report's test time is wrong.`);
    }
  } else if (msgTimes.length) {
    r.messageTime = msgTimes[0];
  }
  if (r.idsMissing.length && r.idsFound.length) notes.push(`Not in the export: ${r.idsMissing.slice(0, 6).join(", ")}${r.idsMissing.length > 6 ? ", …" : ""}.`);

  r.result = verdict.result;
  r.reason = [verdict.reason, ...notes].join(" ");
  r.shows = [...orders.slice(0, 6).map(describeOrder), orders.length > 6 ? `And ${orders.length - 6} more orders.` : "",
             describeSession(r.session)].filter(Boolean).join("\n");
}

// The results as text for the language model: a summary, then one block per test step the client answered.
// "What the messages show" is the longest part, so it is included only for steps that Fail or Need review and for
// steps named in the question; the model can read any other step with get_test_evidence.
export function resultsText(checked, question = "") {
  const asked = ` ${question.toUpperCase().replace(/[^A-Z0-9.-]+/g, " ").replace(/\.(\s)/g, "$1")} `;
  const named = (r) => [r.id, r.ref].some((v) => v && asked.includes(` ${v.toUpperCase()} `));
  const showsFor = (r) => r.shows && (r.result === RESULTS.FAIL || r.result === RESULTS.REVIEW || named(r));
  const c = checked.counts;
  const lines = [
    `# Attached client conformance test report: ${checked.file}`,
    `CompIDs in the report: ${checked.compids.join(", ") || "none"}. Test steps in the report: ${checked.results.length}.`,
    `Results from the automatic checks: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ")}. Overall: ${checked.overall}.`,
    "Each test step the client answered (reference | test ID | test | mandatory | CompID | test time in the report | result | reason | what the messages show, when given):",
  ];
  for (const r of checked.results.filter((x) => x.answered)) {
    lines.push(`- ${r.ref} | ${r.id} | ${r.title.slice(0, 110)} | mandatory ${r.mandatory || "?"} | ${r.compid || "-"} | ${r.time || "-"} | ` +
      `${r.result} | ${r.reason}${showsFor(r) ? ` | ${r.shows.replace(/\n/g, " ")}` : ""}${r.clientComment ? ` | client comment: "${r.clientComment}"` : ""}` +
      `${r.jseComment ? ` | JSE comment: "${r.jseComment}"` : ""}`);
  }
  const notAttempted = checked.results.filter((x) => !x.answered);
  if (notAttempted.length) {
    const marked = notAttempted.filter((x) => x.clientComment).map((x) => `${x.id} ("${x.clientComment}")`);
    const blank = notAttempted.filter((x) => !x.clientComment).map((x) => x.id);
    lines.push(`Not attempted: ${marked.join(", ")}${marked.length && blank.length ? "; " : ""}${blank.length ? `no response at all: ${blank.join(", ")}` : ""}.`);
  }
  if (checked.mandatoryMissing.length) {
    lines.push(`Mandatory steps (market All or Equity Market) with no response and no N/A comment: ${checked.mandatoryMissing.map((x) => x.id).join(", ")}.`);
  }
  return lines.join("\n");
}

// Every message found for the test steps whose reference (T3.6) or test ID (T3-006) is named. For the get_test_evidence tool.
export function evidenceFor(checked, test) {
  const want = String(test || "").trim().toUpperCase();
  const matched = checked.results.filter((r) => r.id.toUpperCase() === want || r.ref.toUpperCase() === want);
  if (!matched.length) return { error: `No test step ${test} in the report. Use a test ID such as T3-006 or a reference such as T3.6.` };
  return matched.map((r) => ({
    ref: r.ref, id: r.id, title: r.title, result: r.result, reason: r.reason, client_wrote: [r.compid, r.time, ...r.fields, r.clientComment].filter(Boolean),
    ids_found: r.idsFound, ids_missing: r.idsMissing,
    messages: [...r.messages, ...r.session].slice(0, 120).map((m) => Object.fromEntries(Object.entries(m).filter(([k, v]) => v !== null && k !== "message_id"))),
  }));
}
