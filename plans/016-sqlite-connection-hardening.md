# Plan 016: Harden SQLite connections and maintain planner statistics

> Executor: only the assigned isolated Orca checkout may be changed. Follow gates, commit locally there, never merge/push or touch `.data/`. Coordinator maintains the plan index.
> Drift: `git diff --stat 133f8a6..HEAD -- src/database.ts src/objects/workspace.ts test/database.test.ts test/objects-demo.test.ts docs/object-contract.md`.

## Status and intent
- P1; effort S; risk LOW–MED; category security/maintenance.
- Planned at `133f8a6`, 2026-09-27; depends on none; research priority 2.
- Outcome: defense-in-depth and bounded planner maintenance without a timer service, new connection mode, or relaxed durability. This is not authentication or a demonstrated vulnerability repair.

## Current state
`src/database.ts:24` constructs Bun `Database(file, {strict:true})`, then enables foreign keys, 5000ms busy timeout, WAL and `synchronous=FULL`. Files are private regular files, symlinks/hardlinks rejected, and handles close on setup error. Bun strict binding is not SQL STRICT tables.

`src/objects/workspace.ts:9` wraps schema initialization plus first demo seeding in an immediate transaction and closes on failure. Existing workspaces never reseed. `ObjectRuntime` rejects unsupported schema versions. There is no `PRAGMA optimize` and `trusted_schema` defaults to ON. Isolated OFF probes already passed initialization/demo/view evaluation, but not the full-suite compatibility gate.

## Scope
Only `src/database.ts`, `src/objects/workspace.ts`, new `test/database.test.ts`, `test/objects-demo.test.ts`, persistence paragraph in `docs/object-contract.md`. Read runtime/views/upgrade code and tests; do not change them here.
Out: schema ownership/version migration (Plan 018), runtime upgrade (017), background scheduler, connection pools, read-only API, FTS/custom functions, global/system settings, user data, provider calls, dependencies.

## Commands/conventions
Bun 1.4.2+, install absent dependencies with `bun install --frozen-lockfile`; `bun run check`, `bun test test/database.test.ts test/objects-demo.test.ts test/objects-upgrade.test.ts`, `bun test`, `git diff --check`. Baseline TS and 91 tests pass. Use existing node:test/strict-assert temporary-file cleanup; never start the default server. Read README/object contract.

## Steps and verification
1. **Set trusted schema OFF for every application connection.** Keep foreign keys/WAL/FULL/busy timeout unchanged, including error closure and path safety. Do not add `immutable` or pretend a writer is read-only. Add in-memory and real temporary-file assertions for actual PRAGMA values; full runtime/demo/upgrade tests establish that installed built-in SQL functions and guards remain usable.
   - Verify `bun test test/database.test.ts test/objects-demo.test.ts test/objects-upgrade.test.ts` succeeds. Invalid path/symlink tests retain the prior safety boundary.
2. **Run bounded optimization only after successful application initialization.** After the outer `openWorkspace` transaction has committed and the supported schema/demo is established, execute `PRAGMA optimize=0x10002` once on that long-lived writable connection. Keep failures explicit and close the handle. Do not put optimize in raw `openDatabase` before schema validation, in a transaction that can still reject the schema, or on a read-only connection. Use a direct call rather than a configurable maintenance abstraction. This plan intentionally chooses startup maintenance only: no periodic timer. Document that continuously running processes may need deliberate `PRAGMA optimize` maintenance and that startup covers schema/index changes made during initialization.
   - Verify tests open/reopen populated disposable WAL workspaces, retain exact logical data/history/receipts, run demo view evaluation and `integrity_check`/`foreign_key_check`. An unsupported-version fixture with existing statistics must be rejected without schema/data/statistics mutation. Do not claim lack of sqlite_stat rows proves optimize ran: small data may not warrant analysis; observe the actual executed pragma in a focused test if necessary.
3. **Document and finish.** Explain OFF limits, placement/startup frequency, no guaranteed speedup, no periodic job and compatibility recheck for future custom functions/virtual-table triggers. References: https://www.sqlite.org/pragma.html#pragma_trusted_schema and https://www.sqlite.org/lang_analyze.html .
   - Verify `bun run check && bun test && git diff --check` exits 0 and scope is clean. Commit with a short imperative subject.

## Done / stop / maintenance
All gates and actual connection assertions pass, full supported upgrades remain usable, unsupported databases are logically unchanged, and startup optimization follows the committed initialization. Stop if OFF breaks a required function/guard, SQLite lacks the documented pragma, failures would be hidden, initialization needs redesign, or two focused repair attempts fail. Plan 018 must preserve this post-validation placement when extracting schema ownership; future workspace read-only connections must not inherit writable planner maintenance. Report exactly what was tested; no power-loss/durability guarantees arise from these tests.
