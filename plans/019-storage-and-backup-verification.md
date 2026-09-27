# Plan 019: Measure synthetic SQLite storage and prove snapshot restoration

> Executor: only the assigned isolated Orca checkout; no original checkout/data/global changes. Coordinator owns index. Commit locally, no merge/push.
> Drift: `git diff --stat 133f8a6..HEAD -- scripts/sqlite-fixture.ts scripts/sqlite-storage.ts test/sqlite-storage.test.ts test/database-backup.test.ts docs/sqlite-measurements.md docs/quickstart.md package.json`.

## Status / outcome
- P2; effort M; risk LOW; category measurement/reliability.
- Planned at `133f8a6`, 2026-09-27; depends on none; research priority 5.
- Deliver a reproducible synthetic `dbstat` report and actual WAL snapshot restore regression tests, not a production telemetry service, history-compression project or new backup product.

## Current state
`src/database.ts` enables foreign keys/WAL/FULL, with in-memory default; `src/objects/runtime.ts` stores full prior snapshots in `object_revisions`, prepared receipt rows and derived `object_references`. `ViewService` archives views and `ViewConversationService.save` commits a draft plus turn atomically. `VisitorStore` retains CSRF/visitor identity. `docs/quickstart.md` currently documents SQLite `.backup` and offline copies, but the reviewed suite has no full restore test or dbstat diagnostic. Installed engine provides DBSTAT and `VACUUM INTO`; the earlier disposable snapshot had `integrity_check=ok` and no FK violations. File existence alone is not restore verification.

## Scope
Only new `scripts/sqlite-fixture.ts`, `scripts/sqlite-storage.ts`, `test/sqlite-storage.test.ts`, `test/database-backup.test.ts`, `docs/sqlite-measurements.md`; script entries in `package.json`; backup section in `docs/quickstart.md`.
Out: production DB inspection/arguments, application APIs, automated backups/rotation/export UI, schema changes, dependency upgrades, compression/deduplication, `.data/`, providers. Plan 020 may reuse the fixture but must not turn it into a generic framework.

## Commands/conventions
Read README/object contract/quickstart. Bun 1.4.2+, absent deps via `bun install --frozen-lockfile`; `bun run check`, `bun test test/sqlite-storage.test.ts test/database-backup.test.ts`, `bun test`, `git diff --check`. Baseline TS and 91 tests pass. Follow node:test/strict-assert, runtime test mkdtemp/close/cleanup patterns. Only temporary databases owned by the command/test may be created/deleted.

## Steps / gates
1. **Build a small bounded synthetic fixture.** One substantive helper builds disposable data using current schema/runtime and canonical commands, with deterministic size/distribution parameters, property/reference relationships, variable writing sizes and a controlled number of revisions. No real workspace copy and no automatic env DATABASE_PATH use. Batch fixture writes inside an outer transaction where appropriate so fixture setup does not dominate timing. It may return generated IDs, DB and an explicit cleanup function; do not add a repository/benchmark plugin architecture. Keep upper bounds on rows, body bytes and revision count. Use sample non-personal writing and valid dates/references.
   - Verify a small fixture has asserted requested counts, expected references/history and exact writing; cleanup closes handles and removes only its own directory. Invalid flags/limits fail before creating a DB.
2. **Expose synthetic storage measurement.** Add `bun run sqlite:storage` for `scripts/sqlite-storage.ts`; default modest fixture (e.g. 1,000 objects with 1KiB writing and two prior revisions), optional clearly bounded scale flags. Accept no existing DB path. Print JSON with Bun/SQLite versions, fixture size/distribution, page size/count/freelist, per-table/index dbstat bytes/pages, database/WAL/SHM file sizes and whether/when checkpointing occurred. SQL anchor:
   ```sql
   SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC;
   ```
   Explain that page allocations include overhead, dbstat totals are not logical payload size, and WAL is distinct. Do not sum table/index/DB files as if independent nonoverlapping logical data. Fail explicitly if DBSTAT is unavailable. Always cleanup on normal/error exit.
   - Verify `bun run sqlite:storage` succeeds and emits consistent nonnegative measurements; compare dbstat totals to allocated file pages with justified metadata/free-page differences, not brittle exact sizes. Unit/command tests check sizes/counts/no user-path option and failure cleanup.
3. **Restore a genuine live-WAL snapshot.** In `test/database-backup.test.ts`, use real temporary files and disable auto-checkpoint during setup so committed data actually resides in WAL. Establish exact records with Unicode/line-ending-sensitive Markdown, revisions, trashed state, receipt replay after editing, references, view publication/history and a conversation/visitor. Create snapshot through static prepared `VACUUM INTO ?` to a new temp filename, while source remains open. Open snapshot read-only first for integrity/FK checks and row comparisons; a mutation must throw SQLITE_READONLY. Then use a writable connection/runtime to a restored temp snapshot and verify canonical reads/history/receipt replay and view evaluation/conversation continuity. This is a test operation, not a new production backup API.
   - Verify source commits made after snapshot are absent from the snapshot; original writing/history/receipts remain intact in both. Assert source/snapshot integrity/FKs and important logical rows, not just file size. Test refusal to overwrite an existing destination without source/destination damage; close every handle before cleanup. `bun test test/database-backup.test.ts` passes.
4. **Document accurate operations/evidence.** Keep existing SQLite `.backup` instructions; add safe restore verification procedure against a separate file, never overwriting live data or casually copying the main WAL file. Explain `VACUUM INTO` compact non-incremental snapshot/interruption limits, stopped-server copies with sidecars, and no claim of cross-file atomic backup for future workspace plans. Add dated synthetic example output/commands and caveats in `docs/sqlite-measurements.md`, not machine-dependent test thresholds.
   - Verify `bun run check && bun test && bun run sqlite:storage && git diff --check` succeeds. Commit only scoped files.

## Done / STOP / maintenance
Measurements are reproducible on temporary synthetic fixtures, full restore assertions pass with committed WAL content, and documentation never invites unsafe live-file replacement. The script never opens `.data` or a caller-selected database, even with DATABASE_PATH set. Stop if the driver cannot make the claimed snapshot/read-only connection, a restore needs unrelated production changes, cleanup cannot be confined, or two repair attempts fail. Future format changes rerun these tests and adapt the fixture, never weaken payload/receipt/history comparisons. These are logical restore checks, not power-loss simulation or a tested crash-durability guarantee.
