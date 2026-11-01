// Loads the gold star schema tables into DuckDB-WASM (the version of DuckDB that runs in the browser).
// The Parquet files and manifest.json are written to gold/ in a private Supabase Storage bucket by code/gold.py,
// and the page downloads them with the Supabase key the user enters in the sidebar.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm";

const SUPABASE_URL = "https://oftjypstiufmzblmtrom.supabase.co";
const SUPABASE_BUCKET = "fix-data";
const LAYER = "gold";

async function download(supabaseKey, name) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${SUPABASE_BUCKET}/${LAYER}/${name}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status} for ${LAYER}/${name}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

// Copies of the gold files are kept in this browser's cache storage (Cache API). manifest.json is always downloaded,
// which also checks the key; when it matches the saved copy, the tables are read from the saved files instead of
// being downloaded again. When gold.py uploads new files, manifest.json changes and every file is downloaded again.
const CACHE_NAME = "gold-tables";

async function openCache() {
  try { return "caches" in self ? await caches.open(CACHE_NAME) : null; } catch { return null; }
}

// onProgress(text, fractionDone) is called before each step.
// Returns { conn, manifest }. manifest.tables[table] has description, rows and columns
// (each column with its description, distinct and empty value counts and most common values).
export async function loadStore(supabaseKey, onProgress) {
  onProgress("Starting DuckDB…", 0);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // Browsers refuse to start a worker from another site's URL, so the worker script is wrapped in a local blob.
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();

  onProgress("Downloading the table list…", 0);
  const manifestText = await (await download(supabaseKey, "manifest.json")).text();
  const manifest = JSON.parse(manifestText);
  const cache = await openCache();
  const saved = cache && await cache.match("manifest.json");
  const useSaved = Boolean(saved) && (await saved.text()) === manifestText;
  if (cache && !useSaved) for (const request of await cache.keys()) await cache.delete(request);

  const tableNames = Object.keys(manifest.tables);
  for (const [i, table] of tableNames.entries()) {
    const file = `${table}.parquet`;
    const hit = useSaved && await cache.match(file);
    onProgress(`Loading table ${i + 1} of ${tableNames.length}: ${table}${hit ? " (saved copy)" : ""}`, i / tableNames.length);
    let bytes;
    if (hit) {
      bytes = await hit.arrayBuffer();
    } else {
      bytes = await (await download(supabaseKey, file)).arrayBuffer();
      if (cache) await cache.put(file, new Response(bytes)).catch(() => {});
    }
    await db.registerFileBuffer(file, new Uint8Array(bytes));
    await conn.query(`CREATE TABLE "${table}" AS SELECT * FROM read_parquet('${file}')`);
    await db.dropFile(file);
  }
  // Saved last, so an interrupted download is never treated as a complete saved copy.
  if (cache && !useSaved) await cache.put("manifest.json", new Response(manifestText)).catch(() => {});

  // The agent's SQL may only read the tables above: no file, network or settings access.
  await conn.query("SET enable_external_access = false");
  await conn.query("SET lock_configuration = true");

  return { conn, manifest };
}
