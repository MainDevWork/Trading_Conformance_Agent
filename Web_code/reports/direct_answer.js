// Answers to questions about an attached client report that the fixed-rule results already hold, written without a
// request to the language model. A question is answered here only when every word in it is on the lists below; any
// other word, such as "why", sends the question to the model.

import { RESULTS } from "./conformance.js?v=29";

const FILLER = new Set(("give me the show list all what are is was were of for this that these those in from on please " +
  "can could would you i we want need see get tell attached client clients report reports file test tests step steps " +
  "so far a an and or which many number count to it they them their its our my").split(" "));
const RESULT_WORDS = new Set("result results outcome outcomes summary summarise summarize verdict overall status check checked".split(" "));
const FILTER_WORDS = {
  fail: RESULTS.FAIL, fails: RESULTS.FAIL, failed: RESULTS.FAIL, failure: RESULTS.FAIL, failures: RESULTS.FAIL, failing: RESULTS.FAIL,
  pass: RESULTS.PASS, passes: RESULTS.PASS, passed: RESULTS.PASS, passing: RESULTS.PASS,
  review: RESULTS.REVIEW, not_attempted: RESULTS.NOT_ATTEMPTED, not_checkable: RESULTS.NOT_CHECKABLE,
};
const FILE_WORDS = new Set(("create make write generate produce download as document version both again another new " +
  "copy one more send export redo regenerate recreate remake rewrite resend updated latest format with").split(" "));
const FILE_TYPE_WORDS = { excel: "excel", xlsx: "excel", spreadsheet: "excel", workbook: "excel", pdf: "pdf" };
// Words that ask for a file to be written, as opposed to a question about a file ("why does the pdf say T3 failed").
const MAKE_WORDS = new Set(("give send create make write generate produce download export redo regenerate recreate " +
  "remake rewrite resend again another new want need get").split(" "));
// "did it pass" asks for the overall result, so its "pass" does not limit the table to the steps that passed.
const OVERALL_WORDS = new Set(["did", "has", "have"]);

const STEP_ID = /^[a-z]{1,2}\d{1,2}(?:[.-]\d{1,3})?$/;

const cell = (text) => String(text ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ").trim();

function table(steps) {
  const rows = steps.map((r) => `| ${cell(r.ref || r.id)} (${cell(r.id)}) | ${cell(r.title).slice(0, 70)} | ${cell(r.result)} | ${cell(r.reason)} |`);
  return ["| Test | What it tests | Result | Reason |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

function resultsAnswer(checked, named, filters) {
  const lines = [];
  if (named.length) {
    lines.push(table(named));
  } else {
    lines.push(`**${checked.file}**: ${checked.overall}.`);
    lines.push(Object.entries(checked.counts).map(([k, v]) => `${k}: ${v}`).join(" · "));
    const wanted = checked.results.filter((r) => (filters.size ? filters.has(r.result) : r.answered && r.result !== RESULTS.NOT_ATTEMPTED));
    lines.push(wanted.length ? table(wanted) : "No test step has this result.");
    if (!filters.size) {
      const skipped = checked.results.filter((r) => r.result === RESULTS.NOT_ATTEMPTED).map((r) => r.id);
      if (skipped.length) lines.push(`Not attempted: ${skipped.join(", ")}.`);
      if (checked.mandatoryMissing.length) lines.push(`Mandatory steps with no response and no N/A comment: ${checked.mandatoryMissing.map((r) => r.id).join(", ")}.`);
    }
  }
  lines.push("These results come from the fixed rules that check the report against the messages.");
  return lines.join("\n\n");
}

// The file type a prompt asks to be written ("excel", "pdf" or "both"), or null. Used after the model has answered:
// a prompt that asks for a file, such as "can you make the pdf again with T3.6 as a pass", must end with a new file
// even when the model replied without calling create_client_report.
export function fileFormatAsked(question) {
  const words = question.toLowerCase().match(/[a-z]+/g) || [];
  const types = new Set(words.map((w) => FILE_TYPE_WORDS[w]).filter(Boolean));
  if (!types.size || !words.some((w) => MAKE_WORDS.has(w))) return null;
  return types.size === 2 ? "both" : [...types][0];
}

// Returns { text } for a question about the results, { format } for a request for the report file, or null when the
// question must go to the language model.
export function directAnswer(checked, question) {
  const words = question.toLowerCase().replace(/[’']s\b/g, "").replace(/\bhow many\b/g, "many")
    .replace(/\bnot attempted\b/g, "not_attempted").replace(/\bnot checkable\b/g, "not_checkable").replace(/\bneeds? review\b/g, "review")
    .match(/[a-z0-9_]+(?:[.-][a-z0-9]+)*/g) || [];
  if (!words.length || words.length > 20) return null;

  const named = [];
  const filters = new Set();
  let wantsResults = false, overall = false, excel = false, pdf = false, fileWord = false;
  for (const w of words) {
    if (FILTER_WORDS[w]) { filters.add(FILTER_WORDS[w]); wantsResults = true; }
    else if (RESULT_WORDS.has(w)) wantsResults = true;
    else if (OVERALL_WORDS.has(w)) overall = true;
    else if (FILE_TYPE_WORDS[w] === "excel") excel = true;
    else if (FILE_TYPE_WORDS[w] === "pdf") pdf = true;
    else if (FILE_WORDS.has(w)) fileWord = true;
    else if (STEP_ID.test(w)) {
      const step = checked.results.find((r) => r.id.toLowerCase() === w || r.ref.toLowerCase() === w);
      if (!step) return null;
      named.push(step);
    } else if (!FILLER.has(w)) return null;
  }
  // "the excel results" or "a pdf of the results" asks for the file; "the failed steps in the pdf" goes to the model.
  if ((excel || pdf) && !filters.size && !named.length) return { format: excel && pdf ? "both" : excel ? "excel" : "pdf" };
  if (excel || pdf || fileWord || !(wantsResults || named.length)) return null;
  return { text: resultsAnswer(checked, named, overall ? new Set() : filters) };
}
