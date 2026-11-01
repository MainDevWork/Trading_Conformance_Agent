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
  const manifest = await (await download(supabaseKey, "manifest.json")).json();
  const tableNames = Object.keys(manifest.tables);
  for (const [i, table] of tableNames.entries()) {
    onProgress(`Loading table ${i + 1} of ${tableNames.length}: ${table}`, i / tableNames.length);
    const response = await download(supabaseKey, `${table}.parquet`);
    const file = `${table}.parquet`;
    await db.registerFileBuffer(file, new Uint8Array(await response.arrayBuffer()));
    await conn.query(`CREATE TABLE "${table}" AS SELECT * FROM read_parquet('${file}')`);
    await db.dropFile(file);
  }

  // The agent's SQL may only read the tables above: no file, network or settings access.
  await conn.query("SET enable_external_access = false");
  await conn.query("SET lock_configuration = true");

  return { conn, manifest };
}
