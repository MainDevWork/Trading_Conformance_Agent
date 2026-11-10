import { chat, summarise, startingChars, plainNames, MODEL_CONTEXT_TOKENS, CONTEXT_WARN_TOKENS, CONTEXT_LIMIT_TOKENS } from "../agent/agent.js?v=20";
import { loadStore } from "../agent/data.js?v=20";
import { readAttachment } from "../reports/attachments.js?v=20";
import { checkReport } from "../reports/conformance.js?v=20";
import { makeClientReport } from "../reports/client_report.js?v=20";
import * as memoryStore from "../agent/memory.js?v=20";

window.appStarted = true;

// The sidebar is hidden and shown by the button at the top left of the chat area. Whether it is hidden is kept in
// this browser's local storage, so it stays the same after a reload.
const sidebarButton = document.getElementById("toggle-sidebar");
function setSidebar(hidden) {
  document.body.classList.toggle("sidebar-hidden", hidden);
  sidebarButton.setAttribute("aria-expanded", String(!hidden));
  sidebarButton.title = hidden ? "Show the sidebar" : "Hide the sidebar";
  try { localStorage.setItem("sidebarHidden", hidden ? "1" : "0"); } catch {}
}
let sidebarHidden = false;
try { sidebarHidden = localStorage.getItem("sidebarHidden") === "1"; } catch {}
setSidebar(sidebarHidden);
sidebarButton.addEventListener("click", () => setSidebar(!document.body.classList.contains("sidebar-hidden")));

const messagesEl = document.getElementById("messages");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const keyInput = document.getElementById("api-key");
const supabaseKeyInput = document.getElementById("supabase-key");

// The keys are never saved: they are held only in the text boxes of the keys form and must be entered again after a
// reload. Keys saved by earlier versions of this page are deleted.
localStorage.removeItem("supabaseKey");
localStorage.removeItem("openrouterKey");

// The Enter keys button opens the keys form. "Use these keys" closes it and starts loading the data; Cancel and the
// Escape key close it and put back the keys entered before it was opened.
const keysDialog = document.getElementById("keys-dialog");
const keyState = document.getElementById("key-state");
let keysBefore = ["", ""];
function showKeyState() {
  const state = (input) => (input.value.trim() ? "entered" : "not entered");
  keyState.textContent = `Database key: ${state(supabaseKeyInput)} · AI API key: ${state(keyInput)}`;
}
function openKeys() {
  keysBefore = [supabaseKeyInput.value, keyInput.value];
  keysDialog.showModal();
  (supabaseKeyInput.value ? keyInput : supabaseKeyInput).focus();
}
document.getElementById("open-keys").addEventListener("click", openKeys);
document.getElementById("keys-cancel").addEventListener("click", () => keysDialog.close("cancel"));
keysDialog.addEventListener("cancel", () => keysDialog.returnValue = "cancel");
keysDialog.addEventListener("close", () => {
  if (keysDialog.returnValue !== "save") [supabaseKeyInput.value, keyInput.value] = keysBefore;
  keysDialog.returnValue = "";
  showKeyState();
  if (!store) start();
});
// A model name saved by earlier versions of this page is deleted: the model is fixed in agent.js.
localStorage.removeItem("model");

// The open conversation (memory.js newConversation) and its questions and answers, which are sent in full to the
// model with every question. Every change is saved to the browser's database, so the conversation is opened again
// after a reload.
let conv = memoryStore.newConversation();
let history = [];
let store = null;

function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(text));
  const div = document.createElement("div");
  div.textContent = text;
  div.style.whiteSpace = "pre-wrap";
  return div.outerHTML;
}

function addMessage(role, text, steps) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const who = { user: "You", assistant: "Agent", error: "Error", attachment: "Attached report",
                summary: "Summary of the earlier conversation, sent with every question" }[role] || role;
  wrap.innerHTML = `<div class="who">${who}</div><div class="body"></div>`;
  const body = wrap.querySelector(".body");
  if (role === "assistant" || role === "summary") body.innerHTML = renderMarkdown(text);
  else body.textContent = text;

  if (steps && steps.length) {
    const box = document.createElement("div");
    box.className = "steps";
    box.textContent = `${steps.length} tool call${steps.length > 1 ? "s" : ""} made to answer this:`;
    for (const step of steps) {
      const d = document.createElement("details");
      const s = document.createElement("summary");
      s.textContent = step.tool === "run_sql" ? `run_sql: ${step.args.sql.slice(0, 90)}…` : `${step.tool} ${JSON.stringify(step.args)}`;
      const pre = document.createElement("pre");
      pre.textContent = (step.args.sql ? step.args.sql + "\n\n" : "") + "Result:\n" + step.result;
      d.append(s, pre);
      box.append(d);
    }
    wrap.append(box);
  }
  messagesEl.append(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}

// The line under an answer that says how long it took and how many requests the language model received.
function timingLine(totalMs, timing) {
  const line = document.createElement("div");
  line.className = "steps";
  const seconds = (ms) => (ms < 10_000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000));
  line.textContent = `Answered in ${seconds(totalMs)} s: ` + (timing.requests
    ? `${seconds(timing.modelMs)} s waiting for the language model, ${timing.requests} request${timing.requests > 1 ? "s" : ""}.`
    : "no request to the language model.");
  return line;
}

// True while a question is being answered, so a second question waits for the first.
let busy = false;
// Cancels the answer being written (an AbortController), or null when no answer is being written. The Stop button
// takes the place of the Send button until the answer ends.
let stopper = null;
stopBtn.addEventListener("click", () => {
  if (!stopper) return;
  stopBtn.disabled = true;
  stopper.abort();
});

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  const apiKey = keyInput.value.trim();
  if (!apiKey) { addMessage("error", "Enter the AI API key first: click Enter keys in the sidebar."); return; }
  if (!store && !loading) start();
  if (!store && !loading) { addMessage("error", "Enter the database key first: click Enter keys in the sidebar."); return; }
  history.push({ role: "user", content: text });
  // A report attached since the last answer: its name is shown on this question.
  const newFile = attached && !attached.shown ? attached.name : null;
  const questionEl = addMessage("user", text);
  if (newFile) showFileName(questionEl, newFile);
  input.value = "";
  busy = true;
  sendBtn.disabled = true;
  const stop = stopper = new AbortController();
  sendBtn.hidden = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;
  // The waiting message shows the current step and the seconds since the question was sent.
  const pending = addMessage("assistant", "");
  const pendingBody = pending.querySelector(".body");
  pendingBody.classList.add("thinking");
  const sentAt = Date.now();
  let step = store ? "Starting" : "Waiting for the data to finish loading";
  // True while the model's text is being shown in the waiting message, in place of the step.
  let writing = false;
  let drawnAt = 0;
  // The text of the reply being written, kept if the analyst presses Stop.
  let partial = "";
  const showStep = () => { if (!writing) pendingBody.textContent = `${step}… ${Math.round((Date.now() - sentAt) / 1000)} s`; };
  const onStep = (text) => { writing = false; partial = ""; pendingBody.classList.add("thinking"); step = text; showStep(); };
  // At most 8 redraws a second; the finished answer replaces this text.
  const onText = (text) => {
    partial = text;
    if (!writing) { writing = true; pendingBody.classList.remove("thinking"); drawnAt = 0; }
    if (Date.now() - drawnAt < 120) return;
    drawnAt = Date.now();
    const atEnd = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
    pendingBody.innerHTML = renderMarkdown(text);
    if (atEnd) messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  showStep();
  const ticker = setInterval(showStep, 1000);
  // The results of a report checked for this question are added under its answer, in a closed section.
  const showResultsOnce = () => {
    if (!attached?.checked || attached.shown) return;
    attached.shown = true;
    showChecked(addMessage("attachment", ""), attached.checked);
    conv.items.push({ role: "attachment", checked: attached.checked });
  };

  try {
    // A question sent while the data is still loading is answered once loading ends, unless Stop is pressed first.
    await Promise.race([loadingDone, new Promise((resolve) => stop.signal.addEventListener("abort", resolve))]);
    if (stop.signal.aborted) throw new Error("Stopped");
    if (!store) throw new Error("The data did not load, so the question could not be answered. See the message in the sidebar.");
    // A report is checked against the messages when the first question is sent with it, not when it is attached.
    if (attached && !attached.checked) {
      step = `Checking ${attached.name} against the messages`;
      showStep();
      attached.checked = await checkReport(store, attached.report, (text) => { step = text; showStep(); });
      conv.attachment = attached.checked;
      renderAttached();
      if (stop.signal.aborted) throw new Error("Stopped");
    }
    const made = [];
    const context = attached ? {
      checked: attached.checked,
      // Called by the create_client_report tool: the files are shown as download links under the answer.
      makeReport: async (args) => {
        const report = await makeClientReport(attached.checked, args);
        made.push(...report.files);
        return { created: report.files.map((f) => f.name), overall: report.overall, results: report.counts, changes_applied: report.applied };
      },
    } : null;
    const data = await chat(store, apiKey, history, onStep, context, await memoryFor(text), onText, stop.signal);
    pending.remove();
    history.push({ role: "assistant", content: data.answer });
    const answerEl = addMessage("assistant", data.answer);
    answerEl.append(timingLine(Date.now() - sentAt, data.timing));
    if (made.length) answerEl.querySelector(".body").append(downloadLinks(made));
    conv.items.push({ role: "user", content: text, ...(newFile ? { file: newFile } : {}) }, { role: "assistant", content: data.answer, steps: data.steps });
    showResultsOnce();
    if (data.tokens.firstPrompt) setTokensPerChar(data.tokens.firstPrompt / data.tokens.firstChars);
    if (data.tokens.largestPrompt) conv.largestPrompt = data.tokens.largestPrompt;
    await saveConv();
  } catch (err) {
    pending.remove();
    if (stop.signal.aborted && partial) {
      // Stopped while the model was writing: the text so far stays in the conversation, with a note, so the model can
      // read what it wrote when the analyst sends the next prompt.
      const kept = `${store ? plainNames(store, partial) : partial}\n\n*Stopped by the analyst before this answer was finished.*`;
      history.push({ role: "assistant", content: kept });
      addMessage("assistant", kept);
      conv.items.push({ role: "user", content: text, ...(newFile ? { file: newFile } : {}) }, { role: "assistant", content: kept, steps: [] });
      showResultsOnce();
      await saveConv();
    } else if (stop.signal.aborted) {
      // Stopped before the model wrote anything: the question stays on screen but is not part of the conversation.
      history.pop();
      const note = document.createElement("div");
      note.className = "steps";
      note.textContent = "Stopped before the model wrote anything. This prompt is not part of the conversation.";
      questionEl.append(note);
    } else {
      history.pop(); // drop the unanswered question so it can be asked again
      addMessage("error", err.message);
    }
  } finally {
    clearInterval(ticker);
    busy = false;
    stopper = null;
    sendBtn.disabled = false;
    sendBtn.hidden = false;
    stopBtn.hidden = true;
    updateContext();
  }
}

form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
});
document.getElementById("clear").addEventListener("click", () => { if (!busy) openConversation(memoryStore.newConversation()); });

// ---- Memory: saved conversations and notes (web/agent/memory.js) ----
const conversationsEl = document.getElementById("conversations");
const notesEl = document.getElementById("notes");
const memoryState = document.getElementById("memory-state");

// The memory passed to the agent for one question. question is used as the conversation's name for a note saved
// during the conversation's first question, before the conversation has a title.
async function memoryFor(question) {
  return {
    notes: await memoryStore.listNotes(),
    carried: conv.carried,
    save: async (text) => { const r = await memoryStore.addNote(text, conv.title || question.slice(0, 70)); renderNotes(); return r; },
    forget: async (number) => { const r = await memoryStore.deleteNote(number); renderNotes(); return r; },
    search: (query) => memoryStore.searchConversations(query, conv.id),
  };
}

async function saveConv() {
  try {
    await memoryStore.saveConversation(conv);
    localStorage.setItem("conversationId", conv.id);
  } catch (err) {
    addMessage("error", `The conversation could not be saved in this browser: ${err.message || err}`);
  }
  renderConversations();
}

// Shows a saved or new conversation: its summary of an earlier conversation, its attached reports, questions and
// answers. Download links of reports written earlier are not saved; the Excel and PDF buttons write them again.
function openConversation(next) {
  conv = next;
  history = conv.items.filter((i) => i.role === "user" || i.role === "assistant").map((i) => ({ role: i.role, content: i.content }));
  messagesEl.innerHTML = "";
  if (conv.carried) addMessage("summary", conv.carried);
  for (const item of conv.items) {
    if (item.role === "attachment") showChecked(addMessage("attachment", ""), item.checked);
    else {
      const el = addMessage(item.role, item.content);
      if (item.file) showFileName(el, item.file);
    }
  }
  if (conv.attachment) setAttached(conv.attachment);
  else detach(false);
  try { localStorage.setItem("conversationId", conv.id); } catch {}
  renderConversations();
  updateContext();
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

async function renderConversations() {
  const list = await memoryStore.listConversations().catch(() => []);
  conversationsEl.innerHTML = "";
  if (!list.length) { conversationsEl.innerHTML = `<li class="hint">No saved conversations yet.</li>`; return; }
  for (const c of list) {
    const li = document.createElement("li");
    if (c.id === conv.id) li.className = "current";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "conv-open";
    open.textContent = c.title || "(no title)";
    open.title = `${c.title}\nLast changed ${formatDate(c.updated)}`;
    open.addEventListener("click", async () => {
      if (busy || c.id === conv.id) return;
      const saved = await memoryStore.getConversation(c.id);
      if (saved) openConversation(saved);
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-delete";
    del.textContent = "×";
    del.title = "Delete this conversation";
    del.setAttribute("aria-label", `Delete the conversation ${c.title}`);
    del.addEventListener("click", async () => {
      if (busy || !confirm(`Delete the conversation "${c.title}"? This cannot be undone.`)) return;
      await memoryStore.deleteConversation(c.id);
      if (c.id === conv.id) openConversation(memoryStore.newConversation());
      else renderConversations();
    });
    const date = document.createElement("span");
    date.className = "conv-date";
    date.textContent = formatDate(c.updated);
    li.append(open, date, del);
    conversationsEl.append(li);
  }
}

async function renderNotes() {
  const notes = await memoryStore.listNotes().catch(() => []);
  notesEl.innerHTML = "";
  if (!notes.length) notesEl.innerHTML = `<li class="hint">No notes yet. Ask the agent to remember something, or it saves findings itself.</li>`;
  for (const n of notes) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `[${n.id}] ${n.text}`;
    text.title = `Saved ${formatDate(n.saved)}${n.conversation ? ` in "${n.conversation}"` : ""}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-delete";
    del.textContent = "×";
    del.title = "Delete this note";
    del.setAttribute("aria-label", `Delete note ${n.id}`);
    del.addEventListener("click", async () => { await memoryStore.deleteNote(n.id); renderNotes(); updateContext(); });
    li.append(text, del);
    notesEl.append(li);
  }
  updateContext();
}

// ---- The context bar ----
// Shows how many tokens the request of the next question starts with, measured against CONTEXT_LIMIT_TOKENS.
// Characters are turned into tokens with the tokens per character of the last first request, as OpenRouter counted
// them; until a question has been answered in this browser, 1 token per 4 characters is used.
const contextEl = document.getElementById("context");
const contextFill = document.getElementById("context-fill");
const contextText = document.getElementById("context-text");
const continueBtn = document.getElementById("continue-new");
let tokensPerChar = 0.25;
let measured = false;
try {
  const savedRatio = Number(localStorage.getItem("tokensPerChar"));
  if (savedRatio > 0.05 && savedRatio < 1) { tokensPerChar = savedRatio; measured = true; }
} catch {}
function setTokensPerChar(ratio) {
  if (!(ratio > 0.05 && ratio < 1)) return;
  tokensPerChar = ratio;
  measured = true;
  try { localStorage.setItem("tokensPerChar", String(ratio)); } catch {}
}

const fmtNum = (x) => Math.round(x).toLocaleString("en-ZA");
async function updateContext() {
  if (!store) { contextEl.hidden = true; return; }
  const notes = await memoryStore.listNotes().catch(() => []);
  const chars = await startingChars(store, history, attached?.checked ? { checked: attached.checked } : null, { notes, carried: conv.carried });
  const tokens = chars * tokensPerChar;
  const level = tokens >= CONTEXT_LIMIT_TOKENS ? "full" : tokens >= CONTEXT_WARN_TOKENS ? "warn" : "ok";
  contextEl.hidden = false;
  contextEl.className = `context-${level}`;
  contextFill.style.width = `${Math.min(100, (100 * tokens) / CONTEXT_LIMIT_TOKENS)}%`;
  const advice = {
    ok: "",
    warn: " Answers become less accurate as a conversation grows: start a new conversation soon.",
    full: " Start a new conversation: answers in a conversation this long are more likely to contain mistakes.",
  }[level];
  contextText.textContent = `Context: ${measured ? "" : "about "}${fmtNum(tokens)} of ${fmtNum(CONTEXT_LIMIT_TOKENS)} tokens ` +
    `(${Math.round((100 * tokens) / CONTEXT_LIMIT_TOKENS)}%).${advice}`;
  contextEl.title = `Tokens the next question's request starts with, before the facts retrieved for it and its tool results.` +
    (conv.largestPrompt ? `\nThe largest request of the last answer held ${fmtNum(conv.largestPrompt)} tokens.` : "") +
    `\nThe model accepts up to ${fmtNum(MODEL_CONTEXT_TOKENS)} tokens, but its answers become less accurate long before that.`;
  continueBtn.hidden = level === "ok" || !history.length;
}

// Continue in a new conversation: the model summarises this conversation, and a new conversation starts with the
// summary and the attached report. The summary is sent with every question of the new conversation.
continueBtn.addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  if (busy) return;
  if (!apiKey) { addMessage("error", "Enter the AI API key first: click Enter keys in the sidebar."); return; }
  busy = true;
  sendBtn.disabled = continueBtn.disabled = true;
  const label = continueBtn.textContent;
  continueBtn.textContent = "Writing a summary of this conversation…";
  try {
    const summary = await summarise(apiKey, history, conv.carried);
    const next = memoryStore.newConversation(summary, conv.attachment);
    if (conv.attachment) next.items.push({ role: "attachment", checked: conv.attachment });
    // A report attached but not yet sent with a question stays attached in the new conversation.
    const unsent = attached && !attached.checked ? attached : null;
    openConversation(next);
    if (unsent) { attached = unsent; renderAttached(); }
    await saveConv();
  } catch (err) {
    addMessage("error", `The summary could not be written: ${err.message || err}`);
  } finally {
    busy = false;
    sendBtn.disabled = continueBtn.disabled = false;
    continueBtn.textContent = label;
  }
});

// ---- Attached client reports ----
// One report is attached at a time. Attaching a file only reads it in this browser and shows its name. The first
// question sent with it checks it against the messages; the results are then sent to the model with each question
// until the report is removed or a new conversation is started.
// attached: { name, report (from attachments.js readAttachment), checked (from conformance.js checkReport, null until
// a question is sent), shown (true once the results section has been added to the chat) }.
let attached = null;
const fileInput = document.getElementById("file-input");
const attachedChip = document.getElementById("attached");

function downloadLinks(files) {
  const box = document.createElement("div");
  box.className = "downloads";
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f.blob);
    a.download = f.name;
    a.textContent = `Download ${f.name}`;
    box.append(a);
  }
  return box;
}

// The line above the question box that names the attached report.
function renderAttached() {
  attachedChip.hidden = !attached;
  attachedChip.querySelector("span").textContent = !attached ? ""
    : attached.checked ? `Attached: ${attached.name}`
    : `Attached: ${attached.name}. It is not checked until you send a prompt.`;
}

// Opens a conversation's report, which was checked when the conversation was saved.
function setAttached(checked) {
  attached = { name: checked.file, report: null, checked, shown: true };
  renderAttached();
}

// The name of the report under the question it was first sent with.
function showFileName(messageEl, name) {
  const line = document.createElement("div");
  line.className = "msg-file";
  line.textContent = `Attached: ${name}`;
  messageEl.append(line);
}

// save = false when a conversation is being opened, so opening it does not change it.
function detach(save = true) {
  attached = null;
  renderAttached();
  if (save && conv.attachment) {
    conv.attachment = null;
    if (conv.items.length) saveConv();
    updateContext();
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// The section shown closed under the first answer about a report. A click opens it: the counts of each result, a table
// of the test steps the client answered, and buttons that write the report for the client without asking the model.
function showChecked(card, checked) {
  const body = card.querySelector(".body");
  const answered = checked.results.filter((r) => r.answered);
  const cls = (r) => `result-${r.result.toLowerCase().replace(/\s+/g, "-")}`;
  body.innerHTML = `<details><summary>Results of checking ${escapeHtml(checked.file)}</summary>` +
    `<p><strong>${escapeHtml(checked.file)}</strong>: ${checked.results.length} test steps, ${answered.length} answered by the client` +
    ` (CompID ${escapeHtml(checked.compids.join(", ") || "none")}). Overall: <strong>${escapeHtml(checked.overall)}</strong>.</p>` +
    `<p>${Object.entries(checked.counts).map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(" · ")}</p>` +
    (checked.mandatoryMissing.length ? `<p>Mandatory steps with no response: ${escapeHtml(checked.mandatoryMissing.map((r) => r.id).join(", "))}</p>` : "") +
    `<table><thead><tr><th>Ref</th><th>Test</th><th>Result</th><th>Reason</th></tr></thead><tbody>${answered.map((r) =>
      `<tr><td>${escapeHtml(r.ref)}</td><td>${escapeHtml(r.id)} ${escapeHtml(r.title.slice(0, 70))}</td><td class="${cls(r)}">${escapeHtml(r.result)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join("")}</tbody></table>` +
    `<p class="hint">Ask the agent about any test step, or write the report for the client:</p></details>`;
  const buttons = document.createElement("div");
  buttons.className = "report-buttons";
  for (const [label, format] of [["Excel report", "excel"], ["PDF report", "pdf"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { body.append(downloadLinks((await makeClientReport(checked, { format })).files)); }
      catch (err) { addMessage("error", `The report could not be written: ${err.message || err}`); }
      finally { b.disabled = false; }
    });
    buttons.append(b);
  }
  body.querySelector("details").append(buttons);
}

// Reads the file and shows its name above the question box. Nothing else happens until a question is sent.
async function attach(file) {
  if (!file) return;
  if (busy) { addMessage("error", "Wait for the answer to finish, then attach the file."); return; }
  busy = true;
  sendBtn.disabled = true;
  attachedChip.hidden = false;
  attachedChip.querySelector("span").textContent = `Reading ${file.name}…`;
  try {
    const report = await readAttachment(file);
    attached = { name: report.name, report, checked: null, shown: false };
  } catch (err) {
    addMessage("error", err.message || String(err));
  } finally {
    busy = false;
    sendBtn.disabled = false;
    renderAttached();
    updateContext();
    input.focus();
  }
}

document.getElementById("attach").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { attach(fileInput.files[0]); fileInput.value = ""; });
document.getElementById("detach").addEventListener("click", () => { if (!busy) detach(); });
// A file dropped anywhere on the chat area is attached.
const mainEl = document.querySelector("main");
mainEl.addEventListener("dragover", (e) => { e.preventDefault(); mainEl.classList.add("dropping"); });
mainEl.addEventListener("dragleave", (e) => { if (!mainEl.contains(e.relatedTarget)) mainEl.classList.remove("dropping"); });
mainEl.addEventListener("drop", (e) => { e.preventDefault(); mainEl.classList.remove("dropping"); attach(e.dataTransfer.files[0]); });

let loading = false;
// Settles when the current load ends, whether it succeeded or failed.
let loadingDone = Promise.resolve();

function start() {
  const supabaseKey = supabaseKeyInput.value.trim();
  if (!supabaseKey || loading) return;
  loading = true;
  loadingDone = load(supabaseKey).finally(() => { loading = false; });
}

async function load(supabaseKey) {
  const text = document.getElementById("status-text");
  const bar = document.getElementById("progress-bar");
  try {
    store = await loadStore(supabaseKey, (message, fraction) => {
      text.textContent = message;
      bar.style.width = `${100 * fraction}%`;
    });
  } catch (err) {
    text.textContent = `Loading failed: ${err.message || err}`;
    return;
  }
  text.textContent = "Data loaded. The agent can answer questions.";
  bar.style.width = "100%";
  updateContext();
}

// The conversation open when the page was last closed is opened again.
async function restore() {
  if (!(await memoryStore.available())) {
    memoryState.textContent = "This browser refused to keep the memory, so conversations and notes are lost when the page is closed.";
  }
  let savedId = null;
  try { savedId = localStorage.getItem("conversationId"); } catch {}
  const saved = savedId ? await memoryStore.getConversation(savedId).catch(() => null) : null;
  openConversation(saved || memoryStore.newConversation());
  renderNotes();
}
restore();
start();
