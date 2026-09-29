# SQLite storage measurements

The storage diagnostic creates an owned temporary database, writes canonical objects/revisions/references, reports SQLite pages with `dbstat`, and deletes only its own directory. It ignores `DATABASE_PATH` and rejects caller-selected database paths.

```sh
bun run sqlite:runtime
bun run sqlite:storage
bun run sqlite:storage -- --objects=20 --body-bytes=256 --revisions=1 --checkpoint
```

Checked evidence: `/tmp/taskdesk-plan020-evidence-dNPOs4/`, on Bun 1.4.2 / SQLite 3.53.2. `runtime.json` records the exact source ID and feature probes; `storage.json` and `storage-checkpoint.json` contain the two storage runs.

Checkpoint example:

```json
{
  "fixture": {
    "objects": 20,
    "bodyBytes": 256,
    "revisions": 1,
    "benchmarkProperties": false
  },
  "page": {
    "pageSize": 4096,
    "pageCount": 44,
    "freelistCount": 0,
    "allocatedBytes": 180224,
    "dbstatBytes": 180224
  },
  "files": { "databaseBytes": 180224, "walBytes": 0, "shmBytes": 32768 },
  "checkpoint": { "requested": true, "result": { "busy": 0, "log": 0, "checkpointed": 0 } }
}
```

Interpretation:

- `dbstat` counts allocated table/index pages, not logical payload sizes. The command fails if `dbstat` is unavailable.
- `page_count * page_size` describes allocated database space; free pages and metadata can explain differences from payload totals.
- Database, WAL and SHM are distinct physical files, not independent logical content categories. Do not infer index size from main-file growth while WAL is active.
- `bodyBytes` is the exact initial UTF-8 body budget. Ordinary historical revisions add small deterministic byte increments. Storage fixtures still contain the original Page/Task workload and single references; benchmark-only properties, rare types, dense arrays and trash are disabled.
- [The benchmark experiments](sqlite-benchmarks.md) use a separate opt-in workload. They report real per-profile fixture setup, read/write medians and spread, candidate build times and `dbstat` candidate bytes (including FTS key uniqueness). Their savepoint write measurements exclude outer commit/fsync and must not be interpreted as durable application latency.

These are synthetic measurements, not a forecast for real workspaces. JSONB, deep pagination and production candidate adoption remain deferred.
