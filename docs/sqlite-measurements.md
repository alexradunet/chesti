# SQLite storage measurements

Dated example: 2026-09-27 on Bun 1.4.2 / SQLite 3.53.2.

Taskdesk includes a synthetic fixture and storage diagnostic for repeatable local measurements. It creates a temporary database, writes objects through the current object runtime, reports SQLite page allocation with `dbstat`, and deletes only its own temporary directory. It never accepts a production database path and ignores `DATABASE_PATH`.

```sh
bun run sqlite:storage
bun run sqlite:storage -- --objects=20 --body-bytes=256 --revisions=1 --checkpoint
```

Example output excerpt from the second command:

```json
{
  "fixture": { "objects": 20, "bodyBytes": 256, "revisions": 1, "referenceEvery": 5 },
  "page": { "pageSize": 4096, "pageCount": 33, "freelistCount": 0, "allocatedBytes": 135168, "dbstatBytes": 135168 },
  "dbstat": [
    { "name": "sqlite_schema", "bytes": 28672, "pages": 7 },
    { "name": "object_revisions", "bytes": 20480, "pages": 5 },
    { "name": "objects", "bytes": 20480, "pages": 5 }
  ],
  "files": { "databaseBytes": 135168, "walBytes": 0, "shmBytes": 32768 },
  "checkpoint": { "requested": true, "result": { "busy": 0, "log": 0, "checkpointed": 0 } }
}
```

Interpretation caveats:

- `dbstat` reports allocated SQLite pages by table or index. It is not the logical size of titles, Markdown, JSON, or revisions.
- `page_count * page_size` is the current allocated database image. Free pages, SQLite metadata, and WAL state can make exact table/index totals differ in other runs.
- The main database, `-wal`, and `-shm` files are distinct physical files. Do not add them together as if they were independent logical payload categories.
- The fixture uses deterministic non-personal writing, typed properties, references, and revision history. It is useful for comparing schema/storage changes, not for estimating every real workspace.
- The diagnostic fails if the SQLite build does not provide the `dbstat` virtual table.
