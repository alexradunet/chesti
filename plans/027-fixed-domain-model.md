# Plan 027: Replace runtime schemas with fixed domains and Markdown-only connections

> **Executor instructions:** The owner subsequently authorized isolated implementation; see `plans/027-execution.md` for the current bounded assignment. This does not authorize inspecting personal data, migrating a live database, merging, or pushing. Read this file completely; it contains the owner's decisions and the preservation gates. Use one isolated Orca worktree and one writer for this cross-cutting replacement. Do not dispatch competing schema/runtime/UI writers.
>
> **Drift check first:** Run `git status --short` and `git diff --stat e5b6ed1..HEAD -- src scripts test public/objects.css README.md docs package.json AGENTS.md`. Compare changed files with the facts below. Stop on conflicting changes or schema-version reuse. Historical execution and publication permissions in other plans do not apply.

## Status

- **Priority:** P1 — agreed product direction, not an urgent defect
- **Effort:** L — schema, commands, forms, queries, migration, and fixtures change together
- **Risk:** HIGH — canonical data, historical records, and saved-view permissions
- **Depends on:** none; sequential internal gates below
- **Category:** architecture / migration
- **Planned at:** `e5b6ed1`, 2026-09-28
- **State:** BLOCKED at Step 1, isolated `c90018b` — two correction rounds exhausted; see `plans/027-step1-blocked.md`. Step 2 and real-workspace cutover are not authorized.
- **Verified baseline:** Bun 1.4.2; `bun run check` passed; `bun test` passed, 169 tests across 19 files, zero failures

## Why this matters

The owner wants deliberate features added through development, occasionally with AI development agents, rather than schema customization during everyday use. Taskdesk currently implements specific task, journal, person, event, and reminder rules on top of a mutable type/property system. Replace that runtime schema system end to end; merely moving its values from JSON to SQL columns would retain most of the complexity.

Keep the useful shared workspace: stable links, Markdown, search, favorites, trash, history, and independently saved AI views. Connections are **Markdown links only**. The owner explicitly rejected a structured Context relationship in favor of the smallest architecture.

## Decisions and non-goals

### Agreed target

1. Exactly six code-defined kinds: Page, Task, Journal, Person, Event, Reminder.
2. A shared `objects` table for identity/content/lifecycle plus five explicit domain tables. Page needs no subtype table.
3. Domain fields are real SQL columns and named TypeScript fields, not arbitrary property dictionaries.
4. Kind is fixed after creation. No user-created types, shared-property definitions, type cloning, editable schema labels, or type conversion.
5. Only Markdown links and derived backlinks connect records. No Context column, reference fields, relationship picker, generic relation table, or parameterized reference-scoped views.
6. Keep safe AI-authored lists, tables, agenda calendars, and boards over a closed set of fields. Views never own records or authorize arbitrary writes.
7. SQLite remains the sole live authority; one Bun process/database, strict TypeScript, native forms, existing Hono JSX components, optional browser enhancement.

### Explicitly out of scope

- Projects, tags, categories, multiple contexts, hierarchy, recurrence, notifications, task statuses beyond Done, attachments, sync, authentication, plugins, a general query/form framework, and an ORM.
- Automatic interpretation of Markdown links as project membership. A mention remains a mention.
- Deleting/recreating the owner's workspace, rewriting Markdown to hide removed properties, flattening custom objects into Pages, or deleting incompatible saved views.
- A second editable legacy runtime, parallel generic/fixed write paths, JSON custom-field bags, compatibility HTTP endpoints, or a universal migration-mapping editor.
- Executing earlier multi-workspace plans 012/013, or importing historical issue/vault data. Those plans have stale schema assumptions and need independent reconciliation if revisited.
- Redesigning the visual system, changing the editor engine, dependency upgrades, speculative performance optimization, or paid provider calls.

## Current state and drift anchors

Read `README.md`, `docs/object-contract.md`, `docs/quickstart.md`, and `docs/design-system.md` before implementation. The current contract describes the existing flexible product; update its affected sections when this replacement is complete, not before.

### Canonical storage and writes

`src/schema.ts:25–71` owns the current schema. The canonical value representation is:

```sql
CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY COLLATE NOCASE, type_id TEXT NOT NULL REFERENCES object_types(id), title TEXT NOT NULL,
  properties_json TEXT NOT NULL CHECK(json_valid(properties_json))
    CONSTRAINT objects_properties_object CHECK(json_valid(properties_json) AND json_type(properties_json) = 'object'),
  body TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL CHECK(revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, trashed INTEGER NOT NULL CHECK(trashed IN (0, 1)),
  body_text TEXT NOT NULL
) STRICT;
```

(The source names the positive-revision expression through a template constant.) `initializeApplicationSchema` at the end of that file accepts versions 1–6, composes older preserving upgrades, and records version 6. Journal date uniqueness currently uses a JSON expression index. Reserved definitions are protected through triggers.

`src/objects/model.ts:41–65` defines the six built-ins and fifteen built-in properties. Those identities, not labels, determine semantics. `ObjectWrite` currently consists of `typeId`, `title`, `properties`, and `body`.

`src/objects/runtime.ts:83–154` owns `catalog`, type creation/renaming, and property attachment/renaming. `createObject`, `updateObject`, `patchProperties`, and `setTrashed` own canonical writes. `createObject` fingerprints the submitted shape **before** Task completion normalization, checks an existing receipt before current target validity, and uses an immediate transaction. `updateObjectFromPrevious` snapshots the previous record and maintains derived links/search atomically.

`src/objects/fingerprint.ts` hashes the stable, recursively key-sorted representation:

```ts
{ typeId: input.typeId, title: input.title, properties: input.properties, body: input.body }
```

Stored receipts contain only this digest and object ID, not the original request. They cannot be safely rehashed from the current object after it has been edited.

### Views and generation

`src/objects/views.ts` validates arbitrary catalog bindings, generates JSON-path SQL, and checks publication, view revision, object revision, source membership, filters, input scope, and trash before calling `patchProperties`. It reads at most 101 body-free rows per block and displays 100. `schemaSignature` records field shapes, not display names.

`src/objects/generator.ts` explicitly projects metadata and exposes only `submit_view`. Its limits are 45 seconds, six tool attempts, eight assistant messages, and twelve earlier user prompts. `src/pi.ts` prevents discovery of personal resources. `src/objects/conversations.ts` saves a generated draft and successful conversation turn in one transaction.

### HTTP, UI, and hidden dependencies

- `src/objects/http.ts`: `readWrite`, `formValue`, `pickerObjects`, and `viewObjects` interpret the dynamic catalog; `/types` and `/properties` expose its mutations. Raw drafts and reviewed revisions are separate from saved records.
- `src/objects/render.tsx`: `Types`, `TypeEditor`, `PropertyControl`, and `ObjectEditor` render generic fields. `SavedConflict`, `ObjectHistory`, People, and view components also read property dictionaries.
- `src/objects/client.ts`: search includes reference selection; the final sections implement schema/type switching. Its save path preserves exact Markdown, retains rejected drafts, and explicitly reconciles conflicts. Do not remove these independent safeguards while removing schema behavior.
- `src/server.ts`: `formBody` currently permits repeated `p:UUID`/`draft:p:UUID` inputs for multiple references. Once those fields disappear, remove this exception; keep body bounds, host/origin checks, CSRF, loopback binding, and security headers.
- `src/objects/workspace.ts`: schema initialization and first demo seeding share a transaction. Existing empty workspaces are not reseeded.
- `scripts/sqlite-fixture.ts` creates custom properties/types. `scripts/sqlite-bench.ts` and storage tests depend on them. Update or retire obsolete experimental scenarios; do not leave a hidden generic runtime for diagnostics.

### Fresh demos are not core-field-only databases

`src/objects/demo.ts:23–32` creates:

```ts
const summary = addProperty(PAGE_TYPE_ID, { label: 'Summary', kind: 'text' });
const related = addProperty(PAGE_TYPE_ID, { label: 'Related pages', kind: 'reference', targetTypeId: PAGE_TYPE_ID, multiple: true });
const context = addProperty(TASK_TYPE_ID, { label: 'Context', kind: 'reference', targetTypeId: PAGE_TYPE_ID });
```

It also shares Context with Event/Reminder/Journal and creates Task Priority and Effort. The Page focus view uses Context and Priority. These generated property UUIDs are not reserved identities; matching labels is not a safe migration rule. Even untouched demo workspaces therefore require a disposition decision before cutover. This plan does not grant that disposition.

### Conventions

Use ordinary functions and cohesive modules, `AppError` for domain/HTTP errors, prepared SQL values, and existing native components imported from `src/ui/index.ts`. Match `test/objects-runtime.test.ts:20–24`:

```ts
function fixture(t: TestContext) {
  const db = openDatabase();
  t.after(() => db.close());
  return { db, runtime: new ObjectRuntime(db) };
}
```

Use `node:test` and `node:assert/strict` under Bun. File-backed tests own private temporary directories and close connections before cleanup. `test/database-backup.test.ts` verifies snapshots that include committed WAL state, immutable history, receipts, conversations, and visitor records; preserve those assertions with fixed-domain fixtures.

## Target model

### Shared record

Keep the name `objects` and existing object URLs to avoid unrelated renames:

```text
objects
  id             TEXT PRIMARY KEY COLLATE NOCASE
  kind           page | task | journal | person | event | reminder
  title          TEXT
  body           TEXT — exact Markdown
  revision       INTEGER > 0
  created_at     TEXT
  updated_at     TEXT
  trashed        INTEGER 0/1
  body_text      TEXT — derived search text
```

Existing IDs, bodies, titles, revisions, timestamps, and trash state survive migration unchanged. Do not regenerate IDs, normalize UUID case in saved writing, or treat migration as a user edit. Keep UUID comparisons case-insensitive where they currently are.

### Domain tables

All tables are `STRICT`. Each `object_id` is a case-insensitive primary key and FK to the common record. Optional fields use SQL NULL for absence; preserve present empty text separately when it exists in stored/API data.

| Table | Columns besides `object_id` | Required rules |
| --- | --- | --- |
| `tasks` | `done`, `scheduled_date`, `due_date` | `done` is 0/1, defaults false; both dates optional, real calendar dates |
| `journals` | `journal_date` | Required real date; UNIQUE across all rows, including trash |
| `people` | `relationship`, `birthday`, `phone`, `job_title`, `favorite_artists`, `last_connected`, `reconnect_every_months` | Optional; dates valid when present; interval integer 1–120 |
| `events` | `start_date`, `end_date`, `starts_at`, `ends_at`, `time_zone` | Exactly one complete date pair or timed triple; start < end, exclusive end; all unused columns NULL |
| `reminders` | `remind_on`, `remind_at` | Exactly one present; real date or timestamp with explicit offset |

Reuse date/time validation from `src/objects/values.ts`; preserve its IANA-zone/offset validation at both event endpoints and instant comparisons. Do not collapse an all-day date into midnight UTC or infer a timezone. Preserve exact existing timestamp spellings where valid. Person reconnect remains a derived calendar-month calculation from `src/objects/people.ts`, including clamping and overflow behavior; do not persist it or expose a new generated-view field during this replacement.

Storage must reject wrong-kind/duplicate subtype rows and invalid journal dates. Canonical creation/update must not commit a common record without its matching subtype. Use nullable **generated** per-kind IDs on `objects`, deferred FKs to the matching subtype, fixed kind guards on subtype insert/ID-update, and an immutable-kind trigger. For example:

```sql
task_row_id TEXT GENERATED ALWAYS AS
  (CASE WHEN kind = 'task' THEN id END) VIRTUAL
  REFERENCES tasks(object_id) DEFERRABLE INITIALLY DEFERRED
```

The subtype's `object_id` is a `PRIMARY KEY COLLATE NOCASE REFERENCES objects(id)`; its guard rejects a parent whose kind is not Task. Create the common row before the subtype inside one transaction. Repeat this small fixed pattern for the other four subtypes, not for Page. These generated keys are not another application-maintained identity and must not be included in writable records. An advisory **in-memory Bun 1.4.2 probe passed** for Task/Page: atomic creation, failed-commit rollback for missing subtype, mixed-case IDs, wrong-kind rejection, immutable kind, subtype-deletion rejection, and integrity/FK checks under `trusted_schema=OFF`. This proves the basic mechanism, not the five-table migration. Add permanent full-domain tests before building higher layers; stop rather than weaken integrity if extension/rebuild exposes a problem.

Keep domain updates and common revision/history/link changes in the same immediate transaction. No independently versioned subtype rows and no separate domain service databases.

### TypeScript and commands

Use a discriminated union with `kind` and concrete field names, such as `TaskRecord.done` and `TaskRecord.dueDate`. Do not preserve `Record<string, PropertyValue>` as a writable domain model. `ObjectRuntime` can remain the single small command owner; a service class per table is unnecessary.

Keep one canonical create/update transaction implementation with explicit kind branches. Shared operations (trash, restore, favorites, title/writing changes) continue to work on any kind. Remove runtime schema commands and the arbitrary `patchProperties` API. View edits dispatch through a closed switch to supported domain edits, ultimately using the same update/validation path as forms. A submitted kind change is rejected, including one disguised as a history restore.

Creation inputs must preserve submitted absence until fingerprinting: an omitted Task Done is distinguishable from explicit false for an existing receipt, even though both persist false on a new task. Optional text `''`, missing values, zero/false, exact Markdown, and timestamp spelling cannot be casually collapsed before hashing.

### Markdown-only links

Use a simple derived edge table, e.g. `object_links(source_id, target_id)`, with the same case-insensitive object FKs and a target-first backlink index. Edges come only from the existing safe Markdown extractor. No property provenance or arbitrary relation kind remains.

Retain the existing rules: multiple mentions yield one source/target edge; self-links are allowed; code/images/raw HTML are not mentions; new links to trashed targets are rejected, retained links survive trash; exact body-preserving edits leave derived search text and links unchanged. Backlinks remain paginated, including source trash indication. Migration must verify that retained writing-edge sets match the saved Markdown; it must not silently delete or reinterpret a structured reference edge.

### Fixed AI-view contract: avoid needless wire-format churn

Retain the existing built-in type and property UUID constants **only as fixed external identifiers for supported view bindings and creation fingerprints**. There are six fixed source identities and fifteen fixed domain-field identities, not database-defined types or properties. This lets compatible current saved specs, view histories, schema signatures, URLs using built-in type IDs, and receipts retain their meaning without an unnecessary second view format.

- Add a small closed `src/objects/fixed-fields.ts` map connecting those constants to domain kind, value shape, and explicit field access. Generator metadata is derived only from this closed map. No registration API, schema revisions, custom options, reference metadata, or forms generated from it.
- Restrict `ViewSpecSchema` to fixed source/field IDs. Keep the current list/table/calendar/board structure, source ordering, explicit columns, bounds, and `editable` flag. Remove `input` declarations and `{input:true}` filter operands entirely.
- Replace database catalog loading with fixed metadata. Keep schema-signature checking against fixed field shapes for existing compatible views; there is no schema editor or live schema lifecycle.
- `views.ts` selects explicit relational columns through developer-authored allowlisted SQL expressions. Never interpolate model-provided identifiers or paths. Values remain prepared parameters. Date/time ranges may be composed into bounded read-only cells; they are not live JSON property storage.
- Preserve empty/notEmpty, false/zero handling, literal contains for text, exclusion of empty values from notEquals, instant/range-start comparisons, source-major ordering, stable title/ID tie breakers, and the 100 + 1 truncation contract.
- Every built-in temporal field remains eligible for its existing calendar display/edit behavior. Range edits update the pair/triple atomically. Clearing required Journal/Event/Reminder schedules is rejected; switching all-day/timed representation stays in the domain editor.
- Boards may group the remaining supported text/boolean fields. Editable boards invoke only the corresponding fixed domain edit; numeric Person reconnect frequency is not a board grouping field. Domain-form edits still validate it normally. There is no generic set-column endpoint.
- Published action authorization still checks current view/object revisions, exposed role, field capability, source kind, filters, and trash. Removing reference input scope is not permission to omit remaining membership checks.
- Keep saved view IDs, prompts, status, tombstones, revisions, timestamps, histories, and conversation references. No generated fallback or provider call during migration/seeding.

This deliberately retains a small declarative presentation layer because AI views remain an agreed feature. It does not retain a user-programmable data model.

### Forms and navigation

Use explicit domain field sections, shared title/writing/save components, and the existing native design system. Keep the object overview with six fixed kinds and List/Gallery browsing, `/tasks`, `/people`, `/calendar`, `/journal`, Search, Favorites, Views, and Trash.

Choose a kind **before entering its editor**, via existing per-kind creation links; New note continues directly to Page. `/objects/new` can still default to Page. Remove the in-form type switch and inactive-property draft machinery rather than implementing another dynamic form engine. Navigating to a different creation screen must use the existing dirty-draft warning. Existing items show their kind without an editable selector.

Use named form fields (`done`, `dueDate`, etc.) and per-kind server-side allowlists. Remove `/types` and `/properties` GET/POST routes and navigation; requests return secured 404s without mutating anything. Old generic editor POSTs must fail explicitly and leave saved data unchanged, not save only the subset of fields the new code recognizes. The cutover procedure requires users to save/copy open drafts before restarting; no silent old-draft conversion.

Keep raw submitted strings separately for validation errors. Preserve normal and reconciled revisions, idempotency tokens, history context, duplicate-journal discovery, explicit preview, exact enhanced title-only/body-preserving saves, native undo, keyboard access, search/link insertion, and assistant targeting. Removing reference-picker modes must not remove ordinary search or Insert object link.

## Preservation and migration policy

### Fundamental rule

**Only a provably lossless fixed-domain workspace migrates automatically. Anything else blocks the entire transaction and produces an actionable report.** This includes Trash, histories, saved/deleted views, metadata customizations, and unsupported content—not just live visible records. A backup is required operational protection, not permission to discard data.

There is deliberately no “force”, “drop extras”, “guess by label”, “convert references to Markdown”, or silent archive-and-hide mode in this plan.

### Read-only preflight

Create `scripts/fixed-domain-preflight.ts` using a bare read-only SQLite connection, not `openDatabase`, `openWorkspace`, or `ObjectRuntime` (those can create/upgrade data and change permissions). Require an explicit path: `bun scripts/fixed-domain-preflight.ts --database /absolute/path/to/snapshot.sqlite`. It must ignore `DATABASE_PATH`, refuse a missing file instead of creating it, reject symlink/unsafe file paths consistently, never chmod an existing source, and never open a writer.

Use one consistent read transaction. Validate integrity and FK state. Scan with bounded batches; report counts and bounded samples of IDs/reasons, not object titles, bodies, prompts, CSRF values, or full records. `--help` explains exit codes: 0 compatible; 2 valid but blocked/requires a preparatory older-format upgrade; 1 usage, unreadable, malformed, or unsupported schema error. Do not equate a truncated sample with a complete inventory.

For v6, inspect:

- All type/property definitions, labels, attachments, options, and reserved shapes. Extra definitions or changed built-in display labels are blockers for this conservative first migration even if no live values use them. Their intended disposition has not been approved.
- Every live and trashed object. It must have an exact built-in identity, only that kind's permitted core fields, and valid values. Shared built-in fields retained after an old type switch are still extras for the new kind.
- Every historical object snapshot, including kinds different from the current record. Known built-in historical kinds are readable, but unknown fields/kinds or malformed snapshots block. Check all rows, not only the most recent revision.
- Every current/deleted saved view and immutable view-history entry: fixed sources/fields, no reference/input dependencies, compatible shape signatures. Already-incompatible views are blockers, not an excuse to delete them.
- Every structured reference edge, including empty-looking metadata cases. Context and Related pages do not become mentions automatically.
- Writing/link target integrity, receipt target integrity, conversation/view FKs, and application table shapes. Inventory extra constraints/triggers/views or unrelated tables that depend on tables being rebuilt; block when their semantics cannot be preserved.

For supported versions 1–5, the standalone report requests a preserving upgrade to v6 **on a disposable backup with the old application** before detailed preflight; it must not upgrade the inspected source. The new startup's existing-format upgrade chain still runs transactionally as specified below. Unknown/newer schema versions always fail closed.

### Schema upgrade

Reserve application schema **version 7**, only if still unused at execution time. Keep `src/schema.ts` the single owner of fresh schema setup and upgrade composition.

- Move existing v1–v6 DDL/upgrade mechanics into a migration-only helper (`src/objects/upgrade-object-schema.ts`) as needed. It may define historical shapes locally; active modules must not import a mutable legacy catalog. Retain existing `upgrade-markdown.ts` support; do not add historical issue/vault conversion.
- For versions 1–5, compose the current preserving upgrade to v6, then fixed-domain validation/conversion in one rollback boundary. Any later blocker undoes all earlier changes, including version bumps and Markdown conversion. Tests of the isolated historical upgrader still prove its existing preservation rules; tests of current startup prove unsupported custom content rolls back unchanged.
- For v6, run the same shared preflight checks inside the migration transaction, not merely trust an earlier report. Revalidate source state after acquiring the write lock.
- For a genuinely new database, install v7 directly, then seed the new fixed demo atomically. Existing v7 databases, including emptied ones, are never reseeded.
- Map reserved identities to kind and SQL columns exactly. No startup edits of Markdown, titles, timestamps, revision counters, or valid scalar spellings. Preserve unrelated tables/files and database metadata that is not being explicitly replaced.
- Rebuild only known application tables/constraints required by the replacement. Account explicitly for every referencing table and trigger before dropping/replacing `objects`; a DROP with active ON DELETE CASCADE could erase favorites. Use a tested SQLite rebuild sequence, not ad hoc ALTER/DROP experimentation against user data. Migration and seeding transaction ownership must remain coherent with `openWorkspace`.
- Before commit, verify all counts/IDs/field projections, history payloads, receipts, conversations, visitors, favorites, view records/history, unrelated sentinels, Markdown equality, and writing edges; run `foreign_key_check` and `integrity_check`. Any failure aborts the whole upgrade. Normal runtime retains foreign keys, WAL, full synchronous durability, and `trusted_schema=OFF`.
- If the rebuild requires temporarily disabling FK enforcement, first prove the exact sequence in isolated tests and obtain reviewer approval. It cannot happen inside the current already-open seeding transaction (SQLite ignores that change there). Restore and verify enforcement before returning a usable connection; never disable `trusted_schema` protection. Do not mask this ordering problem with catch-and-continue or leave enforcement disabled on failure.

### History and idempotency are not expendable

Do not rewrite old immutable view-history rows; compatible fixed view specs retain their exact existing wire shape and signatures.

Preserve old object snapshot JSON and its exact Markdown. Add a small snapshot-format discriminator (old rows default to legacy format; new snapshots use the fixed typed format). A bounded read-only decoder for the **known built-in fields only** may project old snapshots into the new history presentation. This is an immutable-record reader, not a second schema runtime. History of a formerly different built-in kind remains readable; “Open unsaved draft” is unavailable if it would change today's kind or lose fields. Same-kind, representable historical drafts still save through current commands with current validation and explicit revision checks. Multiline historical text must not be silently flattened into a single-line control.

Keep creation receipts and their digest meaning. The smallest option is to retain the existing fingerprint representation internally: project each fixed typed create input to the frozen built-in IDs, then hash with the existing canonical algorithm. Do not rebuild fingerprints from edited records, reset request IDs, or treat a matching request ID alone as success. Preserve missing-vs-present Done before normalization. Round-trip tests must cover every built-in field, empty text, omitted optional fields, exact CRLF/Unicode Markdown, and replays after subsequent edits/trash. New fixed-domain inputs do not expose arbitrary property dictionaries merely because the digest uses historical IDs.

### Real-workspace disposition gate — not yet resolved

No personal database was inspected for this plan. The bundled demo demonstrates that blockers are plausible even without user customization. Before real deployment, obtain permission to inventory an explicitly designated consistent backup. Present the report and get decisions for **each unsupported category**, including schema labels, extra fields, custom kinds, Context/Related pages, dependent views and their histories.

Possible later choices include explicit manual/domain mapping or deliberately starting a separate fresh workspace while retaining the old database with its matching old application. Neither is authorized here. Do not implement a generalized migration engine or choose data loss because a deadline is inconvenient. Until disposition is approved, the new code can be developed and verified on synthetic compatible databases, but the owner's cutover remains BLOCKED.

## Scope

**Files allowed during an assigned implementation:**

- `src/schema.ts`; existing `src/objects/model.ts`, `runtime.ts`, `values.ts`, `people.ts`, `fingerprint.ts`, `views.ts`, `generator.ts`, `conversations.ts`, `http.ts`, `render.tsx`, `client.ts`, `demo.ts`, `workspace.ts`.
- New `src/objects/fixed-fields.ts`, `src/objects/upgrade-fixed-domains.ts`, `src/objects/upgrade-object-schema.ts`, and `src/objects/legacy-records.ts` only where the responsibilities above require them. Do not create an adapter framework or a directory per trivial wrapper.
- `src/objects/upgrade-markdown.ts` only for historical type/import integration, not changed conversion semantics.
- `src/server.ts` for the removed repeated-property form exception and changed type signatures only; `public/objects.css` for removed schema UI and explicit domain layout only.
- `scripts/fixed-domain-preflight.ts` (new), `scripts/sqlite-fixture.ts`, `scripts/sqlite-storage.ts`, `scripts/sqlite-bench.ts` for actual callsite adaptation/removal of obsolete scenarios.
- Existing `test/objects-*.test.ts`, `test/http.test.ts`, `test/database-backup.test.ts`, `test/sqlite-storage.test.ts`, `test/sqlite-bench.test.ts`, `test/ui.test.ts`, `test/pi.test.ts` where contracts/fixtures change.
- New `test/fixed-domain-migration.test.ts`, `test/fixed-domain-preflight.test.ts`, and `test/fixtures/object-schema-v6.ts` for frozen, genuine old-format fixture construction, not version-label faking.
- `README.md`, `docs/object-contract.md`, `docs/quickstart.md`; `docs/design-system.md` only to remove obsolete property-binding wording; `docs/sqlite-measurements.md` and `docs/sqlite-benchmarks.md` to distinguish historical measurements from current diagnostics; the affected product/map paragraphs in `AGENTS.md`.
- This plan and the assignment row in `plans/README.md` if the reviewer delegates status maintenance.

**Do not modify:** `.data/`, any personal backup/source database, credentials, `src/pi.ts`, `src/database.ts` durability/security, `src/visitors.ts` identity semantics, `src/ui/` primitives, the writing engine/renderer/commands, artwork, dependencies/lockfile, unrelated plans, or unrelated files. Existing helper/component files may be read and reused. If new behavior genuinely requires an excluded edit, stop and explain.

## Commands and tools

Run from the assigned checkout using Bun 1.4.2+.

| Purpose | Command | Expected result |
| --- | --- | --- |
| Dependencies, only if missing | `bun install --frozen-lockfile` | Exit 0; lockfile unchanged |
| Typecheck | `bun run check` | Exit 0 |
| Migration/preflight (new tests) | `bun test test/fixed-domain-migration.test.ts test/fixed-domain-preflight.test.ts` | All pass, including rollback and no-write probes |
| Domain/storage | `bun test test/objects-runtime.test.ts test/objects-schema.test.ts test/objects-upgrade.test.ts test/objects-day.test.ts test/objects-people.test.ts test/database-backup.test.ts` | All pass |
| Views/security | `bun test test/objects-views.test.ts test/objects-http.test.ts test/http.test.ts test/pi.test.ts` | All pass; no provider calls |
| Demo/diagnostics | `bun test test/objects-demo.test.ts test/sqlite-storage.test.ts test/sqlite-bench.test.ts` | All pass against fixed fixtures |
| Existing runtime inspection | `bun run sqlite:runtime` | Exit 0; only in-memory SQLite opened |
| Preflight CLI help, once added | `bun scripts/fixed-domain-preflight.ts --help` | Exit 0; explicit-path usage, exit codes, no database opened |
| Full acceptance | `bun run check && bun test && git diff --check` | All exit 0 |

Use the local `orca-development` and `orca-cli` skills for an assigned isolated worktree and Orca's embedded browser. Load version-matched CLI docs before issuing commands. No raw `git worktree`, separate Playwright browser, or unapproved paid agent/provider work. When changing Hono features, reference `https://hono.dev/llms.txt`, `https://hono.dev/llms-small.txt`, and `https://hono.dev/llms-full.txt` before implementation. This plan changes no Pi SDK API or resource-isolation mechanism.

No install is currently needed in the original checkout. The advisory baseline already passed; it is not evidence that a new migration works.

## Execution order and gates

Step 1 can remain independently green. Steps 2–6 replace one tightly coupled contract in a private worktree: use the focused new tests as each layer becomes executable, and track temporary compile/callsite failures explicitly. Do not pretend the old UI/tests can pass after the storage shape changes but before their callers are ported. Verification commands naming dependent existing suites become mandatory combined gates once those callers are updated, no later than Step 6. This is not permission to skip tests, add compatibility write APIs, or publish an intermediate broken/hybrid release. Step 7 requires a clean typecheck and the entire suite together.

### Step 1 — Freeze preservation evidence and implement preflight

1. Confirm baseline/drift and inventory all imports/callers of `Catalog`, `PropertyDefinition`, `ObjectWrite`, `patchProperties`, `catalog`, `getType`, and `getProperty` across `src`, `scripts`, and `test`.
2. Build a genuine v6 fixture independent of the future initializer: six kinds, all fifteen core fields, all-day/timed variants, exact CRLF/Unicode Markdown, links, trash, favorites, edited objects with receipts/history, published/draft/deleted views and immutable view history, visitors and conversations, and an unrelated sentinel table. Include a historical record whose known built-in kind differs from today's kind.
3. Add independent incompatible fixtures: custom kinds/definitions, renamed labels, core fields used on the wrong kind, Context/reference values, old demo semantics, custom-only historical data, input views, malformed data, and unknown version. Do not label a v7 schema “6” to manufacture a migration test.
4. Implement the shared read-only analysis in `upgrade-fixed-domains.ts` and the explicit-path CLI. The CLI's source connection must remain read-only. Keep the report factual and bounded; it does not approve resolution.

**Verify:** `bun test test/fixed-domain-preflight.test.ts && bun run check` → all pass. Test SQL schema/row snapshots and file permissions before/after, missing file creation, WAL-consistent reads, sentinel `DATABASE_PATH`, and nonzero blocker results. The old demo is expected to block, not pass.

**Gate:** Review the blocker categories and preservation fixture before writing destructive DDL. A real-data report is a separate owner-approved operation, not part of this step.

### Step 2 — Prove the fixed storage and transaction design

1. Define fixed discriminated records/writes in `model.ts`, core-field access in `fixed-fields.ts`, and the direct domain DDL owned by `schema.ts`.
2. First prove FK/kind/completeness constraints and migration table-rebuild ordering in isolated test databases. Preserve journal date uniqueness in SQLite, not only TypeScript.
3. Implement the v7 transaction and composed older upgrade boundary. Preserve legacy snapshot JSON with a format tag and unchanged receipts/views/history. Add the narrow decoder/fingerprint projection in `legacy-records.ts` rather than retaining the old live runtime.
4. Compare pre/post semantic fields, original Markdown and historical payloads, IDs, counts, receipts, views, visitors/conversations, favorites, unrelated data, and writing edges. Force failures after each destructive stage and verify the entire old database reopens as before.

**Verify now:** `bun test test/fixed-domain-migration.test.ts` → all direct storage/upgrade tests pass, including a second connection and reopening. Construct these tests against the schema/upgrade functions and frozen fixtures, not the not-yet-ported runtime. No migration may report success solely because row counts match. `integrity_check` must yield `ok`, and `foreign_key_check` no rows. **Combined gate after command/view callers are ported:** `bun test test/objects-schema.test.ts test/objects-upgrade.test.ts test/database-backup.test.ts` → all pass before Step 7.

**Gate:** Reviewer accepts storage ordering before application cutover. This is a private implementation checkpoint, not a shippable mixed-runtime release. Temporary compile failures while replacing shared types must be disclosed and resolved by Step 3; no disabled TypeScript checks or permanent compatibility API may hide them.

### Step 3 — Replace canonical commands and read projections

1. Remove mutable catalog commands, generic property validation, `patchProperties`, and typed-reference maintenance from `runtime.ts`.
2. Implement fixed-kind create/update branches, exact-kind checks on edit, field validation, one shared revision/history transaction, Markdown-only links, and fixed fingerprint projections.
3. Rewrite browse/lookup, count, favorites, day-task, Journal, People, history, and backlink reads for explicit SQL columns. Preserve bounds and lightweight/body-free projections. Task scheduled-or-due matching still deduplicates; completed tasks still appear.
4. Update `people.ts` to consume typed Person fields, preserving every date-calculation edge case.
5. Update substantive domain fixtures and tests. Replace removed-feature tests with rejection/preservation tests where appropriate; do not delete revision/conflict/rollback tests merely because their old fixture used custom types.

**Verify:** `bun test test/objects-runtime.test.ts test/objects-day.test.ts` → ported domain tests pass. Test failed field writes leave main row, subtype row, revision history, links, receipts, and favorites unchanged. The full Domain/storage command and `bun run check` are mandatory once dependent view/HTTP fixtures are ported; record those temporarily outstanding gates rather than claiming an independently integrated checkpoint.

### Step 4 — Narrow saved views and generator metadata

1. Apply the fixed wire-ID contract above in `model.ts`, `fixed-fields.ts`, `views.ts`, and `generator.ts`. Reuse the closed field map for metadata and validation; forms remain explicit.
2. Remove reference/input declaration, filtering, query, and action paths. Never reinterpret an old input view as an unfiltered view.
3. Replace JSON-path querying with static relational expressions and fixed domain action dispatch. Preserve current field shapes/signatures for compatible stored views, temporal semantics, bounds, ordering, source membership, and publication/revision guards.
4. Update generator instructions to describe fixed domains, no invented fields/relations, no schema changes, and metadata-only input. Preserve isolation, tool/time/message bounds, cancellation, explicit failure, and atomic conversation persistence. Do not add object reads to make generation easier.
5. Adapt view tests to real supported fields (e.g. Task Done boards, Task/Journal/Event calendars, Person text groups). Retain cross-source errors, bound values/SQL injection probes, 100 + 1 limits, stale revision failures, and scope changes between display and action.

**Verify:** `bun test test/objects-views.test.ts test/pi.test.ts` → all pass. Add a provider-free test that metadata excludes record content and requests for reference/input/custom-field behavior fail validation. Injected generation verifies the application boundary, not actual model-provider integration. Run `bun run check` again and track any remaining UI/demo/diagnostic callsite failures for Steps 5–6.

### Step 5 — Replace generic forms and remove schema UI

1. Remove `/types`, `/properties`, type/property page models, generic field parsing, reference pickers, and inactive-type draft controls.
2. Build explicit field sections for the five domain tables, retain the shared Page/Markdown editor, and render fixed kind labels. Existing URL identities remain valid; built-in browse query IDs can resolve through the closed map without a database registry.
3. Give each form a strict named-field allowlist; reject unexpected/repeated fields and any attempted kind change. Remove the special repeated-property exception in `server.ts` while preserving all request limits and security behavior.
4. Adapt history and conflict comparison to typed records. Old known-kind snapshots stay readable; cross-kind or unrepresentable history cannot open a lossy edit draft. Same-kind recovery remains revision checked.
5. Remove reference selection/type-management code in `client.ts`, keeping ordinary search, Insert object link, native undo/preview, dirty-state protection, save errors, assistant focus/targeting, and generation-completion draft protection. Retain journal local/default date behavior and fixed-kind creation defaults without rendering every domain's fields invisibly.
6. Rewrite only CSS tied to removed schema screens/layout; reuse the existing native design system and writing components.

**Verify:** `bun test test/objects-http.test.ts test/http.test.ts test/ui.test.ts test/objects-client-state.test.ts test/objects-writing.test.ts` → ported suites pass once the fixed demo needed by HTTP fixtures is in place (bring that Step 6 substep forward if required). HTTP tests must exercise ordinary forms, invalid fields, both conflict rounds, same-kind history drafts, removed routes, kind-change rejection, and unchanged CSRF/host/origin/no-store behavior. Run `bun run check`; only explicitly tracked fixture/diagnostic adaptation may remain for Step 6.

### Step 6 — Replace demo/diagnostics and update the contract

1. Seed only fixed fields and Markdown links. Remove schema-builder tutorials, custom Priority/Effort/Summary/Related pages, Context, and the Page focus input view from **new-workspace seeding only**. Keep useful offline examples: linked Pages, Task Done board/table, compatible calendars, completed/undated tasks, a daily journal, a Person, and trash restoration. Demo size/view count are not goals; preserve useful behavior, not nine property kinds.
2. Verify first initialization plus demo is atomic, existing workspaces are never reseeded, and a failed migration cannot fall through to fresh seeding.
3. Rewrite the synthetic fixture for fixed records and writing links. Remove property-expression and multi-reference benchmark experiments tied to the deleted representation; retain the valid search experiment and the `sqlite:bench` entrypoint with an honest current report. Remove obsolete options/tests, not runtime safety checks. Keep storage/backup tests meaningful.
4. Update README, contract, quick start, and the concise affected AGENTS map/boundaries together. Document six fixed kinds, Markdown-only connections, fixed view capabilities, removed schema editing/input views, history/receipt guarantees, v7 blocking policy, and preflight/backup/cutover steps. Label old performance evidence as historical; do not claim comparable new numbers without measuring.

**Verify:** `bun test test/objects-demo.test.ts test/sqlite-storage.test.ts test/sqlite-bench.test.ts test/database-backup.test.ts && bun run check && bun test` → all pass, including every temporarily deferred gate from Steps 2–5. Run a small diagnostic fixture under a sentinel `DATABASE_PATH` in tests to prove it never opens that file. Verify every documented path/command and removed-feature statement against code.

### Step 7 — Combined review, real browser checks, and handoff

1. Run `bun run check && bun test && git diff --check` with no provider/network requirements.
2. Review the entire diff and search active code for leftover schema mutation, property JSON SQL, Context/reference picker/input-view behavior, and writable property dictionaries. Expected historical mentions must be confined to migration/snapshot/fingerprint preservation, frozen fixtures, and explicitly historical documentation.
3. Run an Orca embedded-browser smoke server using only an owned temporary database. Exercise the matrix below with native and enhanced paths, desktop/narrow layout, and actual keyboard focus. Missing browser access is an explicit verification blocker, not permission to switch tools.
4. Record exactly which checks passed and which remain blocked. Request cutover authorization separately after a real-backup inventory and approved disposition; no original worktree/server restart, merge, push, or database path change is implied by completion of implementation.

**Verify:** full command above exits 0; the browser evidence matrix is complete; diff scope is reviewed. Only then mark implementation DONE. Record rollout separately as BLOCKED or READY WITH OWNER APPROVAL; do not present synthetic migration success as actual user-data migration.

## Required regression matrix

### Storage / migration / preflight

- Genuine compatible v6 → v7 preserves all six kinds, every core value, exact Markdown, identities, timestamps, trash, revisions, receipts, favorites, writing links, views/history, visitor/conversation rows, unrelated tables; reopening makes no further changes.
- v1–v5 composed path: supported old-format conversion succeeds for compatible content; a later incompatible value/history/view causes full rollback to the original schema/version/content. Unsupported v1 writing remains a blocker, as before.
- Extra fields only in Trash, only in history, or only in an old view revision still block. Extra definitions and renamed labels are reported; no label inference. The old demo blocks.
- Unknown version, missing table/column, invalid date/time, malformed snapshot, broken FK, incompatible signature, external schema dependency, and an injected mid-copy failure leave the original logical database unchanged. No seeding on failure.
- Wrong-kind/duplicate/missing subtype, invalid completion/frequency, duplicate journal day including Trash, and invalid schedule shapes cannot be committed through canonical commands; SQL constraints cover the specified storage invariants.
- Read-only preflight does not create a missing file, mutate source schema/rows/permissions, use ambient `DATABASE_PATH`, reveal content/secrets, or omit blockers beyond the sample limit. Verify committed WAL content is seen consistently.
- Preserved creation digest replay returns the same current record after edits/completion/trash; changed payload rejects. Omitted-vs-false Done, optional empty text, exact CRLF, every field/range/timezone, and domain switching attacks are covered.
- Historical source stays exact and readable. A prior different kind cannot change the current kind by opening/saving a draft. Same-kind history retains normal conflicts and all fields.

### Domain / views / HTTP

- Atomic shared+subtype update and rollback, two-connection stale revisions, two consecutive reconciliation conflicts, and create retry after response loss.
- Journal duplicate/Trash/date-move rules, day Journal nonempty-first-save behavior, task day membership/deduplication, Person month-end/leap-year/overflow calculations.
- Link insertion/backlinks, UUID case, self-links, retained trashed links, invalid targets, false positives in code/images/raw HTML, exact unchanged-body derivations, and paginated backlinks/search.
- View sources cannot use another kind's field; input/reference/custom fields reject. Queries bind values, retain temporal/empty/ordering semantics, never load bodies for summaries, and bound rows. Actions recheck current publication, exposed field, both revisions, source/filter membership, and trash before mutation.
- Removed schema endpoints are secured 404s; generic old POST payloads, duplicate fields, and hidden kind changes fail without partial writes. Rejected native/enhanced forms preserve raw drafts/revisions/request IDs.
- Generation failures save no draft/turn; successful draft+turn persistence is atomic and visitor-scoped. Metadata stays fixed and contains no object data; Pi resource isolation remains unchanged.

### Orca browser acceptance

Use synthetic data only; no real provider call is needed.

1. Create and edit each kind with valid and invalid fields; check clear labels and domain-specific schedules. Page has no empty schema-management controls.
2. Tab through fields/save controls; inspect desktop and approximately 390px-wide layouts for overflow/focus. Calendar/People continue to work.
3. Insert a Markdown link using search; Escape restores focus/selection; undo restores source. Verify the target's backlink after saving.
4. Edit writing, navigate toward a different kind/new screen, cancel the dirty warning, and verify all input remains. No hidden type switch silently replaces fields.
5. Trigger stale edits in two contexts: first conflict, explicit comparison, second concurrent conflict, then reconciled save. Drafts remain intact in both enhanced and native paths.
6. Open a same-kind historical draft, reject an invalid save, and retain all draft content; different-kind history is read-only with an explanation.
7. Trash/restore, favorites, daily journal uniqueness, Task Done and dates, Person reconnect calculation, and linked trashed records behave as documented.
8. Preview explicit unsaved Markdown, return to source, and verify no stale preview overwrite; title/domain-only enhanced saves preserve original Markdown bytes.
9. Publish/evaluate/edit a fixture-generated Task board and calendar; draft actions are unavailable; ordinary form and view edits update the same record. Reference input UI and schema management are absent.
10. Assistant navigation/close/reopen/refinement and generation completion during a dirty editor preserve conversation targeting and unsaved drafts. Keyboard drawers/dialogs retain focus behavior.

## Done criteria

All implementation criteria must hold; cutover is a separate owner gate.

- [ ] `bun run check`, `bun test`, and `git diff --check` pass; no disabled checks or credential-dependent tests.
- [ ] Fresh database contains exactly the fixed domain data model, no `object_types`, `object_properties`, or live `properties_json` column; SQL/FK integrity tests pass.
- [ ] No active `createType`, `renameType`, `addProperty`, `renameProperty`, `patchProperties`, runtime catalog queries, reference picker, or input-scoped view endpoint remains. Test this with targeted searches plus negative HTTP/domain tests, not a brittle source-only assertion.
- [ ] Compatible migration is lossless; incompatible migration/preflight fails with preserved originals; prior histories/receipts remain meaningful; no old flexible write path exists.
- [ ] Six-domain forms, queries, demo, views, generator metadata, scripts, tests, and documentation agree on the same fixed contract.
- [ ] Full real-browser matrix is verified through Orca, or delivery is explicitly BLOCKED for missing checks.
- [ ] Only scoped files changed; no credentials, personal data, provider calls, dependency churn, or live-workspace changes.
- [ ] Reviewer records implementation status and the separate real-data disposition/cutover status in `plans/README.md`.

## STOP conditions

Stop and report rather than improvise if:

- Schema version 7 is already used, concurrent edits change this contract, or an executor is not in its assigned isolated checkout.
- A preservation requirement is being relaxed to make a migration pass; unsupported data is encountered without an explicit approved mapping/disposition.
- A saved view must be unscoped, deleted, or silently changed to migrate; a timestamp/date or v6 Markdown body must be normalized; a receipt would be inferred from current edited content. The existing tested v1 structured-writing-to-Markdown conversion is the explicitly retained earlier-format exception, not permission for new rewriting.
- Table rebuild ordering threatens child rows, immutable history, unrelated schema objects, or FK/durability enforcement. Resolve in fixtures and review, never against personal data.
- The proposed subtype integrity design cannot be proved on Bun 1.4.2 without a substantially more complex mechanism.
- The cutover would restart a live watch server or open the real database without separate authorization.
- Scope requires new product behavior, a generic archive/mapping service, excluded files/dependencies, extra provider privileges, or a separate browser.
- A gate fails twice after reasonable focused corrections; provide the failing evidence and remaining issue rather than suppressing tests or escalating scope silently.

## Maintenance notes and handoff

New kinds/fields now require ordinary reviewed changes to SQL migration, discriminated types/validation, domain form/commands, fixed view metadata if exposed, tests, and docs. Adding a field does not mean rebuilding a schema editor. Do not persist derived values merely to expose them in a view.

Built-in UUIDs retained at the view/fingerprint boundary are stable protocol identifiers, not a promise of arbitrary runtime schema support. Never reuse a field ID for a different meaning/shape. Historical decoders and preflight are preservation code; keep them narrow and tested, not extensible.

The largest unresolved issue is **disposition of actual unsupported workspace content**, not the target domain model. A successful synthetic implementation is useful progress but cannot justify a real-data reset or a claim that the owner's existing workspace is migration-ready. No plan-specific implementation, migration, merge, or push has occurred during this advisory assignment.
