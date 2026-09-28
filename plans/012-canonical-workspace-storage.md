# Plan 012: Establish fresh canonical storage for independent workspaces

> **Executor instructions:** This is an implementation handoff, not authorization to execute. Obtain a separate implementation assignment. Then follow the steps and verification gates; stop on the conditions below. Update this plan's row in `plans/README.md` only if your reviewer has assigned you that responsibility. Historical execution/publication permissions in the index do not apply.
>
> **Drift check first:** `git status --short` and `git diff --stat 133f8a6..HEAD -- src/database.ts src/schema.ts src/workspaces.ts src/server.ts src/visitors.ts src/objects/runtime.ts src/objects/workspace.ts src/objects/views.ts src/objects/conversations.ts src/objects/upgrade-markdown.ts test README.md docs/object-contract.md docs/quickstart.md AGENTS.md`. Compare changed files with the current-state facts below. Stop on unrelated edits, an incompatible schema, or changed requirements; do not overwrite another writer's work.

## Status

- **Priority:** P1 — prerequisite
- **Effort:** L
- **Risk:** HIGH — initialization, identity, durability, and database lifecycle
- **Depends on:** none
- **Category:** direction / architecture
- **Planned at:** commit `133f8a6`, 2026-09-27
- **State:** TODO; planning approved, implementation unassigned

## Why this matters

The owner wants separate SQLite files for private and AI-shared workspaces, not a per-object permission system. Existing domain services already bind to one database, making file-level separation a smaller change than putting a workspace predicate on every object query. Establish the storage boundary first, preserving object semantics and eliminating superseded initialization/conversion paths.

The owner accepts a fresh canonical format and does not require legacy migration. **This does not authorize deleting, resetting, importing, or experimenting on the existing `.data/`.** Old databases must remain untouched and unsupported versions must fail explicitly.

## Current state

- `src/database.ts:6–32` opens an in-memory database by default, checks private regular files/directories, and enables foreign keys, WAL, a busy timeout, and `synchronous=FULL`.
- `src/server.ts:62–66` chooses one database for the whole application:

  ```ts
  const objects = options.objects ?? openWorkspace(process.env.DATABASE_PATH ?? resolvePath('.data/taskdesk.sqlite'));
  const visitors = new VisitorStore(objects.db);
  const objectRoutes = createObjectRoutes(objects, options.viewGenerator);
  ```

- `src/objects/runtime.ts:133–170` owns core schema setup; it accepts object versions 1, 2, and 3, converts version 1, installs built-ins, then records version 3:

  ```ts
  if (version && !['1', '2', '3'].includes(version.value)) throw new Error('Unsupported object database schema.');
  if (version?.value === '1') upgradeObjectMarkdown(db, fingerprint);
  ```

- `src/objects/views.ts:171–197`, `src/objects/conversations.ts:12–25`, and `src/visitors.ts:13–16` also execute DDL in service constructors. View-history guards and conversation foreign keys must not disappear when moving this DDL.
- `src/objects/workspace.ts:6–23` wraps first initialization and `seedDemo(objects)` in one immediate transaction. An existing workspace is never reseeded merely because its objects or views are empty.
- `src/objects/model.ts` is the active domain/type authority. Objects use stable UUIDs, JSON property values, exact Markdown, revisions, and trash. Built-in identities are constants, not labels.
- The existing `browser_visitors` cookie is conversation identity/CSRF state, **not owner authentication**.
- Audit probes confirmed two independent `ObjectRuntime` instances do not find each other's objects. This is a useful foundation, not proof of HTTP authorization.

### Existing conventions and invariants

Use ordinary TypeScript functions/services, Bun SQLite, prepared values, `AppError`, and the existing `node:test` / `node:assert/strict` tests. For example, `test/objects-runtime.test.ts:20–24` owns and closes its database:

```ts
function fixture(t: TestContext) {
  const db = openDatabase();
  t.after(() => db.close());
  return { db, runtime: new ObjectRuntime(db) };
}
```

Preserve the contract: SQLite is authoritative; views reference objects; Markdown is never silently rewritten; object revisions, prior snapshots, backlinks, and creation receipts commit together. Journal date uniqueness includes Trash. Built-in types/core fields remain protected while display names remain editable. Draft/conversation commits remain atomic. Unrelated tables in a supported database remain untouched.

## Smallest complete design

1. Keep relational identity/invariants plus JSON property values. No EAV, JSONB conversion, new database engine, or new network service.
2. Use a server-configured **`WORKSPACES_PATH`**, default `.data/workspaces/`. Within it:
   - `app.sqlite`: a small administrative database containing the workspace catalog, its own schema version, and persistent browser visitor/CSRF records;
   - `<workspace-uuid>.sqlite`: one independent canonical object database per registered workspace, including objects, types, properties, views, conversations, revisions, receipts, and backlinks.
3. The administrative database is deliberately not another object store or permission engine. It avoids JSON sidecars, filesystem discovery as a live catalog, or storing every browser's identity in an arbitrarily chosen workspace. It contains no object bodies or values. Later read-only connections will be associated with a workspace here.
4. Server-generated lowercase UUIDs determine filenames. Names are display labels only. No client-supplied directory, filename, SQL attachment, or absolute path is accepted. Each workspace database records its own workspace UUID; opening it under a different registry identity fails.
5. Expose one small `WorkspaceStore` in `src/workspaces.ts`: create, bounded list, get/open, revision-checked rename, close. Cache database-bound runtimes for the application's lifetime; no pool, eviction policy, service locator, or mutable active-workspace variable.
6. Fresh object format is **version 4**; fresh administrative format is **version 1**. Only a genuinely empty database can be initialized. Reject legacy object versions 1–3, newer versions, and unversioned nonempty/partial databases without modifying their logical schema/data. Do not pretend an unrelated database is a blank workspace.
7. New application workspaces retain the existing transactional demo behavior. Low-level `ObjectRuntime(openDatabase())` tests remain schema-only. Workspace creation must not invoke a provider.
8. Plan 013 will expose multiple workspaces in the UI. At this intermediate checkpoint the existing unprefixed UI may bind once at startup to the earliest registered workspace; it must not change that binding mid-request or expose an ad hoc selection API. Remove that intermediate selection when Plan 013 lands. Do not describe this checkpoint as an agent security boundary.

## Commands you will need

Run from the assigned repository/worktree using Bun 1.4.2+.

| Purpose | Command | Expected result |
| --- | --- | --- |
| Dependencies, only if absent | `bun install --frozen-lockfile` | Exit 0; checked-in lockfile unchanged |
| Baseline/typecheck | `bun run check` | Exit 0; no TypeScript errors |
| Existing storage contracts | `bun test test/objects-runtime.test.ts test/objects-views.test.ts test/objects-demo.test.ts test/objects-markdown.test.ts` | All pass |
| New initialization/store contracts | `bun test test/workspaces.test.ts test/objects-schema.test.ts` | All pass after these files are added |
| HTTP/lifecycle regressions | `bun test test/http.test.ts test/objects-http.test.ts` | All pass |
| Full gate | `bun test` | No failing tests; no provider/network dependency |
| Diff hygiene | `git diff --check` | Exit 0 |

The audited baseline had 91 passing tests and a clean typecheck. Do not require the same test count after replacing obsolete upgrade-success tests with rejection tests.

## Scope

**Only these files may change:**

- `src/schema.ts` and `src/workspaces.ts` (new).
- `src/database.ts`, `src/server.ts`, `src/visitors.ts` for safe opening/composition/lifecycle only.
- `src/objects/runtime.ts`, `workspace.ts`, `views.ts`, `conversations.ts` for schema ownership and database binding; preserve domain commands.
- Delete `src/objects/upgrade-markdown.ts` after removing its callers.
- `test/workspaces.test.ts`, `test/objects-schema.test.ts` (new); `test/workspace-fixture.ts` if needed to share substantive HTTP setup.
- `test/objects-runtime.test.ts`, `test/objects-demo.test.ts`, `test/objects-views.test.ts`, `test/http.test.ts`, `test/objects-http.test.ts` for the changed initialization/lifecycle contract. Replace/remove `test/objects-upgrade.test.ts` only as described below.
- `README.md`, `docs/object-contract.md`, `docs/quickstart.md`, and the affected storage map/boundaries in `AGENTS.md`.
- This plan/index for outcome evidence.

**Out of scope:** application UI redesign or workspace routing; AI tools/authentication; deleting a workspace; moving/copying objects between workspaces; import/migration/export tooling; per-object ACLs; FTS/embeddings; dependency changes; generator/editor behavior. Read `src/objects/model.ts`, `demo.ts`, and the Markdown helpers, but do not alter their product semantics. Do not modify other local skills or `.data/`.

## Git / executor toolkit

Use the local `orca-development` skill for Orca-managed work. Use the assigned isolated checkout; one writer per checkout. If a branch is requested, suggest `improve/012-workspace-storage`. No commit, merge, push, cleanup of other worktrees, or publication is authorized by this document; follow the separate assignment. Existing commits use short imperative subjects, such as `Fix reference search draft retention`.

Read `README.md`, `docs/object-contract.md`, and `docs/quickstart.md` before editing. Inspect all callers of `openWorkspace`, `createApp`, `VisitorStore`, and each moved schema constructor.

## Steps

### 1. Establish the baseline and characterize the preserved guarantees

Run the drift check and existing tests before editing. Add `test/objects-schema.test.ts` and `test/workspaces.test.ts` as their implementation becomes available; use temporary directories and explicit cleanup, never the default application path. Preserve existing tests for revision conflicts, exact Markdown including unusual Unicode, receipt replay after later edits, references, view-history immutability, and Journal uniqueness across connections.

Record expected contract changes explicitly: successful v1/v2/v3 conversion is being removed, not fixed. Existing old-database fixtures can be reused to assert refusal and unchanged logical contents. Do not delete unrelated object regression assertions to reduce failures.

**Verify:** `bun run check && bun test` → clean baseline. If baseline failures are unrelated, stop and report them before continuing.

### 2. Centralize and version canonical initialization

Create `src/schema.ts` as the single DDL owner for the object database and the small administrative database. Move the existing core, built-in, view, view-history, and conversation schema definitions here, retaining their constraints/guards. `ObjectRuntime` can call the idempotent initializer so in-memory tests remain simple; view/conversation/visitor service constructors should only prepare/use existing tables.

- On an empty object database, create all its tables/guards and version 4 transactionally. Persist one workspace UUID; the managed creation path supplies the registry UUID, while schema-only fixtures can generate one.
- On reopen, verify the supported version, required structure, and any supplied expected workspace UUID. Do not rerun migrations, reset labels, refill missing content, or silently repair a partial schema.
- The administrative initializer creates version 1, workspace catalog rows (`id`, display `name`, `revision`, `created_at`), and the existing visitor table. Keep browser identity out of workspace object databases in the new format.
- Keep the first workspace initialization plus demo writes inside the same object-database transaction. No provider calls or object copies.
- Remove the old Markdown upgrader import/file and the legacy version branches. Rewrite upgrade documentation and tests accordingly. Preserve regression coverage of current-format Markdown rendering/editing; those features are not legacy.

**Verify:** `bun test test/objects-schema.test.ts test/objects-runtime.test.ts test/objects-views.test.ts test/objects-demo.test.ts test/objects-markdown.test.ts` → pass; old versions/partial schemas fail without logical changes, fresh/reopened canonical data passes. `rg -n 'upgradeObjectMarkdown|upgrade-markdown' src` → no matches (expected `rg` exit 1).

### 3. Implement the bounded workspace catalog and safe connection ownership

Implement `WorkspaceStore` with direct SQL and ordinary methods. Workspace names are trimmed, nonempty, at most 80 characters, escaped on later rendering, and never used in paths. Rename requires the current positive revision, preserves identity/file location, and increments that revision. Bound catalog pages to at most 50 entries with explicit continuation; stable ordering must not depend on a mutable name.

Use `openDatabase`'s private-file checks for both administrative and workspace databases. Reject malformed IDs before path construction. Lookup must consult the catalog and verify an existing private file before opening: an unknown ID or missing registered file must never create a database or fall back to the first workspace. Validate embedded workspace identity on opening. Do not enumerate arbitrary directories to discover/import workspaces.

Creation spans two files, so do not claim a cross-database atomic transaction:

1. Generate an ID and exclusively create its file; do not overwrite an existing candidate.
2. Complete canonical initialization/demo in that file.
3. Register it only after successful initialization. A normal failure closes all new handles and returns an explicit error, with no visible successful catalog entry.
4. A crash before registration can leave an unregistered file. Never automatically adopt, overwrite, or delete it. Document this recovery boundary. Before auto-creating the first workspace in an empty catalog, detect leftover managed workspace filenames and stop with an actionable recovery error rather than silently producing another first workspace. This bounded filename check is not directory import.

Open only registered workspaces. Keep an ordinary map of opened runtimes, close all owned handles on shutdown/startup failure, and make close idempotent. Do not use `ATTACH` or cross-workspace SQL. Root initialization must not silently recreate a missing administrative catalog over existing managed workspace files.

**Verify:** `bun test test/workspaces.test.ts` → create/list/reopen/rename pass; wrong UUID/file identity, missing files, symlinks/hardlinks, catalog-write failure, orphaned first initialization, and close/retry cases fail safely without damaging other files.

### 4. Wire the store into application startup and tests

Replace the single `DATABASE_PATH` composition with the workspace store and persistent visitors from `app.sqlite`. Reject a supplied obsolete `DATABASE_PATH` with clear instructions to select a fresh `WORKSPACES_PATH`; do not ignore it or copy its contents. Default startup creates only the new managed root/first workspace, leaving `.data/taskdesk.sqlite` untouched.

Make resource ownership explicit in `createApp` and its callers. A small returned application handle with the Bun server and an asynchronous `close()` is acceptable: stop/drain HTTP first, then close the store. Update every HTTP fixture and main-entry shutdown path together. Do not retain the old `objects` injection as a second live application mode. Tests may create their store under `mkdtempSync` and use an injected deterministic `ViewGenerator`; that is not verification of real Pi generation.

For this storage-only checkpoint bind the legacy route service once to the first registered workspace. This is a transitional composition, not a global mutable active workspace or permission mechanism. Assets and existing forms continue to work, while Plan 013 replaces all unqualified object routes.

**Verify:** `bun test test/http.test.ts test/objects-http.test.ts test/workspaces.test.ts` → pass, including persistent visitor/conversation continuity after reopening and no dangling connections after application close.

### 5. Update operational documentation and finish the gates

Document fresh initialization, the managed directory layout, the temporary single-workspace UI checkpoint, `WORKSPACES_PATH`, unsupported legacy versions, and no automatic deletion/migration. Document **one running application per managed root**. Keep the exact built-in/Markdown/history guarantees.

For a consistent application backup, stop the server and back up the entire managed root, preserving any remaining WAL/SHM files. A SQLite online backup can capture an individual workspace, but multiple independent online backups are not one atomic whole-application snapshot. Include the administrative catalog/visitor state in full backups. Do not invent hot cross-file snapshots or import/recovery commands.

Update the `AGENTS.md` project map to replace the retired upgrader entry; keep the embedded Pi isolation rules and Orca browser policy unchanged.

**Verify:** `bun run check && bun test && git diff --check` → exit 0. `rg -n 'DATABASE_PATH|schema version [123]|version-[123]|upgrade-markdown' README.md docs AGENTS.md src` → manually review every remaining match: only explicit legacy refusal/documentation is acceptable, not instructions promising conversion or the old default.

## Test plan

Use `test/objects-runtime.test.ts` and `test/objects-demo.test.ts` for temporary-file/reopening patterns, and existing HTTP fixtures for actual request tests.

- Schema: empty initialization, reopen without reseeding or changing saved content, supported database with an unrelated table preserved, legacy/newer/unversioned-partial refusal, failed initialization rollback.
- Data: exact Markdown/history/receipts/backlinks, reserved IDs/guards, Journal uniqueness including Trash, view deletion without object mutation, atomic draft/conversation writes.
- Isolation: two managed files; distinct custom types/properties/objects/views/conversations; foreign IDs fail locally; the same Journal date is valid independently in both. Include equal built-in type IDs with different local display names.
- Catalog/path safety: invalid IDs/names, rename conflict, missing file, wrong embedded UUID, symlink/hardlink refusal, exclusive-create collision, registry insertion failure and preserved pre-existing files.
- Lifecycle: repeated open reuses the intended handle; failed startup closes what it opened; application close permits clean reopening; no unknown request creates a file.
- Baseline HTTP protection tests remain active. This plan does not add owner authentication or prove agent access control.

## Done criteria

- [ ] `bun run check`, `bun test`, and `git diff --check` all succeed.
- [ ] New storage/schema tests exercise separate real temporary database files and the failure cases above.
- [ ] Only supported canonical initialization remains; `rg -n 'upgradeObjectMarkdown|upgrade-markdown' src` finds nothing.
- [ ] Every database has one clear owner/close path; no default-path test or user-data access occurred.
- [ ] Docs accurately describe the fresh format and intermediate UI; no migration/reset promise remains.
- [ ] `git status --short` / `git diff --name-only` match the allowed scope, and the handoff states commands/results and any blockers.
- [ ] The assigned index owner records completion, actual commit if any, and verification evidence. No unassigned publication occurred.

## STOP conditions

- Anything requires reading, resetting, converting, or deleting the owner's existing `.data/`.
- A changed caller needs compatibility with legacy databases or another live storage model. Ask rather than restoring duplicate runtimes.
- The design requires cross-workspace references, schema sharing, object movement, an extra network service, or a generic repository/policy layer.
- Initialization can accept an unsupported/partial database by silently filling it in, or missing-file lookup can create a replacement.
- Creating a workspace needs a stronger crash-recovery product than the explicitly documented unregistered-file failure state. Report the tradeoff; do not invent a journal/recovery subsystem.
- A verification gate fails twice after a reasonable targeted repair, or changes need an unlisted source file.

## Maintenance notes

Keep future DDL in the canonical initializer and preserve each database's independent version/UUID. Fresh-format permission applies to the legacy cutover, **not** to dropping workspaces created under version 4 later. Any subsequent supported-format upgrade must be explicit, transactional, and data-preserving. Plan 013 supplies explicit HTTP/UI scope; Plan 014 supplies owner/agent authorization and read-only access. Neither should add `workspace_id` columns to every object table.
