# SQLite storage measurements

Dated example: 2026-09-27 on Bun 1.4.2 / SQLite as reported by the running Bun binary.

Taskdesk includes two disposable SQLite diagnostics:

```sh
bun run sqlite:storage
bun run sqlite:storage -- --objects=20 --body-bytes=256 --revisions=1 --checkpoint
bun run sqlite:bench
```

Both create temporary databases, write objects through the current object runtime, reject caller-selected database paths, and delete only their owned temporary directories. The storage diagnostic keeps the ordinary workload unchanged (`benchmarkProperties:false`); benchmark-only properties and denser reference arrays are opt-in inside `sqlite:bench`.

Recent benchmark artifacts from the repair run are under `/tmp/taskdesk-plan020-repair/`:

- `sqlite-bench-default.json`
- `sqlite-bench-largewriting.json`
- `sqlite-bench-small-stress.json`

Interpretation caveats:

- `dbstat` reports allocated SQLite pages by table or index. It is not the logical size of titles, Markdown, JSON, or revisions.
- Benchmark setup time is measured fixture construction. Candidate index/FTS build time is separate from read/write medians.
- Main database, WAL, and SHM files are physical files; benchmark storage conclusions use `dbstat` bytes for candidate tables/indexes.
- The fixture uses deterministic non-personal writing, typed properties, references, trash, and revision history. It is useful for comparing bounded schema/search experiments, not for estimating every real workspace.
- The diagnostic fails if the SQLite build does not provide the `dbstat` virtual table.
