import { chat, DEFAULT_MODEL } from "./agent.js";
import { loadStore } from "./data.js";

const messagesEl = document.getElementById("messages");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const modelInput = document.getElementById("model");
const keyInput = document.getElementById("api-key");
const supabaseKeyInput = document.getElementById("supabase-key");

// The keys are never saved: they are held only in the text boxes and must be pasted again after a reload.
// Keys saved by earlier versions of this page are deleted.
localStorage.removeItem("supabaseKey");
localStorage.removeItem("openrouterKey");
supabaseKeyInput.addEventListener("change", () => { if (!store) start(); });
// The model name is saved in this browser's localStorage so it survives a page reload.
modelInput.value = localStorage.getItem("model") || DEFAULT_MODEL;
modelInput.addEventListener("change", () => localStorage.setItem("model", modelInput.value.trim()));

// The visible conversation, sent in full to the model with every question.
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
  const who = { user: "You", assistant: "Agent", error: "Error" }[role] || role;
  wrap.innerHTML = `<div class="who">${who}</div><div class="body"></div>`;
  const body = wrap.querySelector(".body");
  if (role === "assistant") body.innerHTML = renderMarkdown(text);
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

async function send(text) {
  text = text.trim();
  if (!text || sendBtn.disabled) return;
  const apiKey = keyInput.value.trim();
  if (!apiKey) { addMessage("error", "Enter your OpenRouter key in the sidebar first."); return; }
  history.push({ role: "user", content: text });
  addMessage("user", text);
  input.value = "";
  sendBtn.disabled = true;
  const pending = addMessage("assistant", "_Querying the message data…_");
  pending.querySelector(".body").classList.add("thinking");

  try {
    const data = await chat(store, apiKey, history, modelInput.value.trim() || null);
    pending.remove();
    history.push({ role: "assistant", content: data.answer });
    addMessage("assistant", data.answer);
  } catch (err) {
    pending.remove();
    history.pop(); // drop the unanswered question so it can be asked again
    addMessage("error", err.message);
  } finally {
    sendBtn.disabled = !store;
  }
}

form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
});
document.querySelectorAll("#examples li").forEach((li) => li.addEventListener("click", () => send(li.textContent)));
document.getElementById("clear").addEventListener("click", () => { history = []; messagesEl.innerHTML = ""; });

let loading = false;

async function start() {
  const supabaseKey = supabaseKeyInput.value.trim();
  if (!supabaseKey || loading) return;
  loading = true;
  const text = document.getElementById("status-text");
  const bar = document.getElementById("progress-bar");
  sendBtn.disabled = true;
  try {
    store = await loadStore(supabaseKey, (message, fraction) => {
      text.textContent = message;
      bar.style.width = `${100 * fraction}%`;
    });
  } catch (err) {
    text.textContent = `Loading failed: ${err.message || err}`;
    return;
  } finally {
    loading = false;
  }
  text.textContent = `Loaded from Supabase (${store.manifest.built_from})`;
  bar.style.width = "100%";
  const rows = Object.entries(store.manifest.tables).map(([name, t]) => `<tr><td>${name}</td><td>${t.rows.toLocaleString()}</td></tr>`);
  document.getElementById("tables").innerHTML = rows.join("");
  sendBtn.disabled = false;
}
start();
