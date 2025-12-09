// main.ts
// Single-worker sql.js-httpvfs setup + simple "run SQL" UI.

import {
  createDbWorker,
  type WorkerHttpvfs,
} from "npm:sql.js-httpvfs@0.8.12";

// Your DB lives at /games.db (served via Deno file server)
const DB_URL = "/games.db";

// These will resolve to same-origin URLs once bundled.
// Make sure *actual files* exist at these paths next to bundle.js.
const workerUrl = new URL("./sqlite.worker.js", import.meta.url);
const wasmUrl = new URL("./sql-wasm.wasm", import.meta.url);

let workerPromise: Promise<WorkerHttpvfs> | null = null;

function setStatus(msg: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// Lazy-init the worker once and reuse it
async function getWorker(): Promise<WorkerHttpvfs> {
  if (!workerPromise) {
    workerPromise = (async () => {
      setStatus("Connecting to DB…");

      const worker = await createDbWorker(
        [
          {
            from: "inline",
            config: {
              // "full" = single .sqlite file, accessed via HTTP range
              serverMode: "full",
              url: DB_URL,
              requestChunkSize: 4096, // 4 KiB is fine
            },
          },
        ],
        workerUrl.toString(),
        wasmUrl.toString(),
      );

      setStatus("Connected.");
      return worker;
    })().catch((err) => {
      console.error("Failed to init DB worker", err);
      setStatus("Error initializing DB.");
      throw err;
    });
  }
  return workerPromise;
}

// Generic query helper: returns array of row objects
async function runQuery(
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const worker = await getWorker();
  // sql.js-httpvfs: db.query returns Promise<object[]>
  const rows = await worker.db.query(sql, params) as Record<string, unknown>[];
  return rows;
}

// --- Minimal UI wiring (textarea + button + pre) --- //

const sqlInput = document.getElementById("sql") as HTMLTextAreaElement | null;
const runBtn = document.getElementById("runBtn") as HTMLButtonElement | null;
const outEl = document.getElementById("out") as HTMLPreElement | null;

async function handleRunClick() {
  if (!sqlInput || !runBtn || !outEl) return;

  const sql = sqlInput.value.trim();
  if (!sql) {
    outEl.textContent = "Please enter a SQL query.";
    return;
  }

  runBtn.disabled = true;
  setStatus("Running…");
  outEl.textContent = "";

  try {
    const rows = await runQuery(sql);
    if (!rows.length) {
      outEl.textContent = "No rows.";
    } else {
      outEl.textContent = JSON.stringify(rows, null, 2);
    }
    setStatus(`Done. ${rows.length} row(s).`);
  } catch (e) {
    console.error("Query error", e);
    outEl.textContent =
      "Error: " + (e instanceof Error ? e.message : String(e));
    setStatus("Error.");
  } finally {
    runBtn.disabled = false;
  }
}

if (runBtn) {
  runBtn.addEventListener("click", handleRunClick);
}

if (sqlInput) {
  sqlInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRunClick();
    }
  });
}

// Optional: sanity check on load
(async () => {
  try {
    const rows = await runQuery(
      "SELECT COUNT(*) AS n FROM games;",
    );
    console.log("games table row count:", rows[0]?.n);
  } catch (err) {
    console.error("Sanity check query failed:", err);
  }
})();
