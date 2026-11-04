// The agent's memory, kept in this browser's own database (IndexedDB), on this computer only. It is deleted when the
// browser's site data for the page is cleared, and other computers and other analysts do not have it.
// Two kinds of record are kept:
// - conversations: every question, answer and attached report of each conversation, so a conversation can be opened
//   again after the page is reloaded, and the agent can search earlier conversations;
// - notes: short facts the agent saves with its save_memory tool, sent to the model with every question of every
//   conversation.

const DB_NAME = "conformance-agent";
const DB_VERSION = 1;
const MAX_NOTE_CHARS = 500;
const MAX_NOTES = 100;

// When the browser refuses IndexedDB (for example in some private windows), the records are kept in these maps
// instead, and are lost when the page is closed. available() tells the page which of the two is used.
const fallback = { conversations: new Map(), notes: new Map() };
let usingFallback = false;
let nextFallbackNote = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (err) { reject(err); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("conversations")) db.createObjectStore("conversations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const dbReady = openDb().catch(() => { usingFallback = true; return null; });

// Runs one request on one store and returns its result.
async function run(storeName, mode, makeRequest) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = makeRequest(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function available() {
  await dbReady;
  return !usingFallback;
}

// ---- Conversations ----
// A conversation: { id, title, created, updated, items, carried, attachment }
// - items: what the page shows, in order: { role: "user" | "assistant", content, steps } and { role: "attachment", checked }
// - carried: the summary of an earlier conversation that this one continues, or null
// - attachment: the checked results of the report attached now (conformance.js checkReport), or null

export function newConversation(carried = null, attachment = null) {
  const now = new Date().toISOString();
  return { id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`, title: "", created: now, updated: now,
           items: [], carried, attachment };
}

export async function saveConversation(conv) {
  conv.updated = new Date().toISOString();
  if (!conv.title) {
    const first = conv.items.find((i) => i.role === "user");
    if (first) conv.title = first.content.replace(/\s+/g, " ").trim().slice(0, 70);
  }
  if (usingFallback || !(await dbReady)) { fallback.conversations.set(conv.id, structuredClone(conv)); return; }
  await run("conversations", "readwrite", (s) => s.put(conv));
}

export async function getConversation(id) {
  if (usingFallback || !(await dbReady)) return structuredClone(fallback.conversations.get(id) ?? null);
  return (await run("conversations", "readonly", (s) => s.get(id))) ?? null;
}

export async function deleteConversation(id) {
  if (usingFallback || !(await dbReady)) { fallback.conversations.delete(id); return; }
  await run("conversations", "readwrite", (s) => s.delete(id));
}

async function allConversations() {
  if (usingFallback || !(await dbReady)) return [...fallback.conversations.values()];
  return run("conversations", "readonly", (s) => s.getAll());
}

// Conversations that hold at least one question, newest first: { id, title, updated }.
export async function listConversations() {
  return (await allConversations()).filter((c) => c.items.some((i) => i.role === "user"))
    .sort((a, b) => b.updated.localeCompare(a.updated)).map(({ id, title, updated }) => ({ id, title, updated }));
}

// The model's search_past_conversations tool. A conversation scores one point for each word of the query found in
// its questions, answers or carried summary. Returns the 5 highest-scoring conversations other than the open one,
// each with up to 3 passages of about 400 characters around the words found.
export async function searchConversations(query, excludeId) {
  const words = [...new Set(String(query || "").toLowerCase().match(/[a-z0-9][a-z0-9.\-]*/g) || [])].filter((w) => w.length > 1);
  if (!words.length) return { error: "Give the words to search for, such as a CompID, a test ID or a month." };
  const found = [];
  for (const c of await allConversations()) {
    if (c.id === excludeId) continue;
    const parts = [c.carried || "", ...c.items.filter((i) => i.role === "user" || i.role === "assistant")
      .map((i) => `${i.role === "user" ? "Analyst" : "Agent"}: ${i.content}`)];
    const text = parts.join("\n\n");
    const lower = text.toLowerCase();
    const hits = words.filter((w) => lower.includes(w));
    if (!hits.length) continue;
    const passages = [];
    for (const w of hits.slice(0, 3)) {
      const at = lower.indexOf(w);
      passages.push(`…${text.slice(Math.max(0, at - 150), at + 250).replace(/\s+/g, " ")}…`);
    }
    found.push({ score: hits.length, conversation: c.title || "(no title)", date: c.updated.slice(0, 10), words_found: hits, passages });
  }
  found.sort((a, b) => b.score - a.score);
  return { conversations: found.slice(0, 5).map(({ score, ...rest }) => rest),
           note: found.length ? null : "No earlier conversation contains these words." };
}

// ---- Notes ----
// A note: { id, text, saved, conversation }: conversation is the title of the conversation it was saved in.

export async function listNotes() {
  const notes = usingFallback || !(await dbReady) ? [...fallback.notes.values()] : await run("notes", "readonly", (s) => s.getAll());
  return notes.sort((a, b) => a.id - b.id);
}

export async function addNote(text, conversation = "") {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);
  if (!text) return { error: "The note is empty." };
  const notes = await listNotes();
  if (notes.some((n) => n.text.toLowerCase() === text.toLowerCase())) return { saved: false, note: "This note is already saved." };
  if (notes.length >= MAX_NOTES) return { error: `${MAX_NOTES} notes are saved, the most allowed. Ask the analyst which to delete, then call forget_memory.` };
  const note = { text, saved: new Date().toISOString(), conversation };
  if (usingFallback || !(await dbReady)) {
    note.id = nextFallbackNote++;
    fallback.notes.set(note.id, note);
  } else {
    note.id = await run("notes", "readwrite", (s) => s.add(note));
  }
  return { saved: true, id: note.id };
}

export async function deleteNote(id) {
  id = Number(id);
  const exists = (await listNotes()).some((n) => n.id === id);
  if (!exists) return { error: `No note number ${id}.` };
  if (usingFallback || !(await dbReady)) fallback.notes.delete(id);
  else await run("notes", "readwrite", (s) => s.delete(id));
  return { deleted: id };
}
