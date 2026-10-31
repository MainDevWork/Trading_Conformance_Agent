// Loads the FIX message tables into DuckDB-WASM (the version of DuckDB that runs in the browser).
// The Parquet files and manifest.json are written by code/build_site_data.py and uploaded by
// code/upload_to_supabase.py to a private Supabase Storage bucket, which the page downloads with the
// Supabase key the user enters in the sidebar.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm";

const SUPABASE_URL = "https://oftjypstiufmzblmtrom.supabase.co";
const SUPABASE_BUCKET = "fix-data";

const COMMON_COLUMNS = ["source_month", "source_file", "timestamp", "comp_id", "message_type", "client_order_id"];
// Columns that link cancels and amends to the order they target, cast to text so tables that store them
// with different types can be combined. order_cancel_replace_request names its column original_client_order_id.
const LINK_COLUMNS = { order_id: ["order_id"], orig_client_order_id: ["orig_client_order_id", "original_client_order_id"] };

async function download(supabaseKey, name) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${SUPABASE_BUCKET}/${name}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status} for ${name}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

// onProgress(text, fractionDone) is called before each step.
// Returns { conn, manifest, columns } where columns[table] is [{name, type}, ...].
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
  const columns = {};
  for (const [i, table] of tableNames.entries()) {
    onProgress(`Loading table ${i + 1} of ${tableNames.length}: ${table}`, i / tableNames.length);
    const response = await download(supabaseKey, `${table}.parquet`);
    const file = `${table}.parquet`;
    await db.registerFileBuffer(file, new Uint8Array(await response.arrayBuffer()));
    await conn.query(`CREATE TABLE "${table}" AS SELECT * FROM read_parquet('${file}')`);
    await db.dropFile(file);
    columns[table] = (await conn.query(`DESCRIBE "${table}"`)).toArray()
      .map((r) => ({ name: r.column_name, type: r.column_type }));
  }

  onProgress("Preparing the all_messages view…", 1);
  const selects = tableNames.map((table) => {
    const have = new Set(columns[table].map((c) => c.name));
    const parts = COMMON_COLUMNS.map((c) => (have.has(c) ? c : `NULL AS ${c}`));
    for (const [name, sources] of Object.entries(LINK_COLUMNS)) {
      const source = sources.find((c) => have.has(c));
      parts.push(source ? `CAST("${source}" AS VARCHAR) AS ${name}` : `CAST(NULL AS VARCHAR) AS ${name}`);
    }
    return `SELECT '${table}' AS table_name, ${parts.join(", ")} FROM "${table}"`;
  });
  await conn.query("CREATE VIEW all_messages AS " + selects.join(" UNION ALL BY NAME "));

  // The agent's SQL may only read the tables above: no file, network or settings access.
  await conn.query("SET enable_external_access = false");
  await conn.query("SET lock_configuration = true");

  return { conn, manifest, columns };
}
