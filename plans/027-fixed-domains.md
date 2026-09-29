# Plan 027: Build six fixed domains on a fresh database

> **Latest owner decision:** “we can start with a clean slate if it's simpler, I dont have any prod datra.” Use the simpler fresh-database approach. This supersedes the earlier preservation-migration proposal: no v6→v7 converter, compatibility layer, legacy preflight gate, or migration trial is required. It does **not** authorize deleting existing files, resetting Git history, touching the original checkout, or weakening safety for newly created data.
>
> **Executor instructions:** Read this complete plan and the assigned scope. Keep one implementation writer in the existing isolated worktree; use local `orca-development` and version-matched `orca-cli` guidance. Do not load the advisory `improve` skill as an implementation role. The lead owns the planning records. This revision is planning only, not a claim that the application has changed.
>
> **Drift check:** Run `git status --short`, `git rev-parse HEAD`, and `git diff --stat ad2e6da5133694c0f1d305dbf017710fc09397ec..HEAD -- src scripts test public README.md docs package.json bun.lock AGENTS.md`. Reconcile changed callers and unknown edits before implementation. These planning files may be uncommitted; give an executor the full plan explicitly.

## Status

- **Priority:** P1; owner-selected simplification.
- **Effort:** L for the coherent caller cutover, substantially smaller than preservation plus cutover.
- **Risk:** MED–HIGH for application regressions; historical-data conversion risk removed by not converting.
- **Category:** direction / architecture.
- **Planned at:** `ad2e6da5133694c0f1d305dbf017710fc09397ec`, 2026-09-28.
- **Worktree:** `/home/alex/orca/workspaces/GenUIExperiment/fixed-domains`.
- **Branch:** `alexradunet/fixed-domains`.
- **Status:** STEP 2 ACCEPTED WITH A RECORDED GAP; Step 3 review complete, follow-up open. The owner chose to accept Step 2 rather than commission a third revision round, and to record the lost regression coverage instead of blocking on it. See [027-review.md](027-review.md) for lead-verified evidence and findings F1–F7. Earlier Step 1 preflight work is superseded, not retroactively accepted as a migration gate.
- **Implementation:** commits `0751f73`, `baeb2c2`, `f59a253`, plus follow-up `5cb09c6` and `02fee65` on `alexradunet/fixed-domains`. Lead re-ran `bun run check` (pass), `bun test` (50 pass, 0 fail, 18 files), `git diff --check ad2e6da..HEAD` (clean), and `sqlite:bench` on v7 (exit 0).
- **Follow-up outcome:** F1, F2, F3, F5, F6, and F7 are fixed and lead-verified in Orca's browser and against throwaway databases. Domain change now discloses exactly which values will drop, requires an explicit confirmation in both the native and enhanced paths, preserves the edited draft, and keeps the prior state in history. Residual low-severity items F8 (the editor form loses its enhancement after the disclosure replacement), F9 (one loose test assertion), and F10 (no client-side test for the confirmation contract) are recorded in [027-review.md](027-review.md).
- **Still open:** F4 — the six broader guarantee areas (host validation, revision conflict, favorites, trash/Journal uniqueness, immutable view history, atomic conversation/draft writes) have no regression tests; owner-accepted and manually re-verified, but unguarded. ~390px layout and real model generation remain unverified.
- **Dependencies:** existing object/history/view/security contracts; do not execute unrelated plans 012/013.

### Prior work retained in Git, not on the new critical path

Commits `c3d58b4`, `969981d`, `c90018b`, `3990a76`, and `ad2e6da` implemented/repaired a conservative v6 preflight. Reviews found actual false positives despite green tests; the last repair fixed case-sensitive external-FK detection with a failing-before/passing-after regression. Preserve those commits. There is no reason to spend more on their migration acceptance or maintain that tool in a fresh-only application.

At `ad2e6da`, Bun 1.4.2, TypeScript, all **201 tests across 20 files**, the **32-test preflight suite**, and diff hygiene passed. Those are the last code verification results, not results of this planning revision. No user database was inspected, migrated or deleted. After obsolete tests are deliberately retired, a lower test count is acceptable; lost current-product coverage is not.

## Outcome and simplest design

Taskdesk offers exactly **Page, Task, Event, Reminder, Journal, Person**. Their fields and labels are defined in code; there is no schema editor, custom type/property creation, select/reference property kind, or input-scoped relation view. Objects still own data, AI still produces untrusted declarative views, and connections are ordinary Markdown links with derived backlinks.

Keep the one-process Bun/SQLite architecture, native textarea/forms/browser enhancement, Hono JSX rendering, existing screens and styling. Keep the existing type/field UUID constants and shared `objects` table with `type_id` and `properties_json` because replacing those encodings adds work without user value—not because old databases must be supported. Do not introduce six storage tables, an ORM, a registry, plugins, repositories or an event bus.

Create a **fresh schema version 7** so an existing v1–v6 file cannot be mistaken for the new format. No in-place upgrades, table rebuilds, FK-disable migration choreography, legacy DDL fingerprints, source/destination inventories, migration CLI or automatic reset. Reject unsupported files with instructions to select a new database path. Leave old files available for the old application if wanted.

## Current state and files to understand

Read `AGENTS.md`, `README.md`, `docs/object-contract.md`, `docs/quickstart.md`, and `docs/design-system.md` before changing their respective behavior. Keep strict TypeScript and the existing `node:test` / `node:assert/strict` conventions. If changing Hono features, read the Hono LLM references required by `AGENTS.md`; no framework change is needed.

| File | Current responsibility / consequence |
| --- | --- |
| `src/objects/model.ts` | Six built-ins/fifteen fields plus generic metadata, reference/select kinds, input views and schema-editor drafts. Narrow to the fixed contract. |
| `src/schema.ts` | Current v1–v6 upgrade coordinator and mutable definitions. Replace with fresh/current-v7 initialization and version rejection. |
| `src/database.ts`, `src/objects/workspace.ts` | Safe file opening, pragmas, transactional first initialization/demo, optimization after success. Never reset existing workspaces. |
| `src/objects/runtime.ts` | SQL catalog, schema mutation APIs, object validation/history/receipts, typed and writing edges, bounded domain queries. |
| `src/objects/views.ts`, `generator.ts` | Reference/select/input semantics occur in schemas, validation, SQL, commands and prompts; all must narrow together. |
| `src/objects/http.ts`, `render.tsx`, `client.ts`, `public/objects.css` | Schema editors, retained-field/type-switch forms, reference/input pickers and rendering. Hiding navigation alone is not removal. |
| `src/objects/demo.ts` | Current demo creates custom fields and relation views; replace with a fixed-domain demo. |
| `scripts/sqlite-fixture.ts`, `sqlite-bench.ts`, `sqlite-storage.ts` | Synthetic callers rely on custom fields/types/references; adapt or retire obsolete scenarios, not the new product constraints. |
| `test/database-backup.test.ts`, `test/objects-*.test.ts` | Existing tests often set up generic schemas. Port relevant behavior to fixed-domain fixtures; remove only genuinely retired feature assertions. |

Verified excerpts at the planned commit:

`src/objects/runtime.ts:84–88` currently reads mutable definitions:

```ts
catalog(): Catalog {
  return {
    types: this.db.query<TypeRow, []>('SELECT * FROM object_types ORDER BY name COLLATE NOCASE, id').all().map(objectType),
    properties: this.db.query<PropertyRow, []>('SELECT * FROM object_properties ORDER BY label COLLATE NOCASE, id').all().map(propertyDefinition),
  };
}
```

`src/schema.ts` imports `upgradeObjectMarkdown` and accepts versions `1` through `6`. `src/objects/workspace.ts` calls `new ObjectRuntime(db)` inside an immediate transaction, seeds only first initialization, then runs `PRAGMA optimize=0x10002`. Retain fresh initialization/demo atomicity and never optimize a rejected workspace.

`src/objects/runtime.ts` checks `fingerprint(write)` receipts before Task completion normalization and current target state. Retain that ordering for new data: retries must not reset an edited/completed object. Existing view commands also reload revisions, publication and membership before canonical writes; simplification must preserve those checks.

## Fixed contract

| Domain | Fields / rules |
| --- | --- |
| Page | Title and Markdown; no extra fields. |
| Task | Done boolean, optional Scheduled and Due dates. Default missing Done to false on canonical creation after receipt fingerprinting. |
| Event | Exactly one All-day dates or Event time range, exclusive end; existing offset/time-zone validation. |
| Reminder | Exactly one date or timestamp. No notifications, recurrence or invented completion field. |
| Journal | Required real calendar date, unique including Trash; opening reuses the canonical object. |
| Person | Optional Relationship, Birthday, Phone number, Job title, Favorite artists, Reconnect every (integer months 1–120), Last connected. Next reconnect is derived on read. |

All objects retain independent title/Markdown, stable identity, revision, timestamps and Trash. Values must belong to the selected domain; unknown and wrong-domain keys reject. Use existing scalar/temporal/Markdown validators and code-owned metadata, not duplicate browser business rules. Returned metadata must not allow callers to mutate global definitions.

- No mutable definition tables or schema mutation APIs. Keep only supported scalar/range kinds.
- `object_references` becomes writing-only source/target pairs, case-insensitive, unique, with FKs and a target index. No `property_id` or typed-reference provenance.
- Keep object history, creation receipts, favorites, visitors/CSRF, views/immutable view history, and atomic conversations for **new v7 workspaces**. These are current product features, not legacy baggage.
- Views keep list/table/calendar/board, fixed-field bindings/filters/order, bounded projections and existing command permissions. Boards group text or boolean; calendars use temporal fields. Reject `input`, `{input:true}` and retired `inputId` submissions instead of ignoring them and widening queries.
- Keep view structural-signature protection, but use only fixed field IDs/kinds; there is no requirement to retain the old reference-shaped tuple encoding for new databases.
- Keep Markdown source authoritative and exact on initialization/non-writing updates, native undo and nonmutating safe preview, safe links and bounded writing. Raw HTML/images stay inert. No model access to stored content, files, shell or arbitrary tools.
- Preserve explicit domain selection/change, rather than quietly dropping data. Selection alone is nonmutating. A saved-domain change that removes current fields must disclose those fields and require native-form confirmation; the complete prior object goes into history. Rejected saves retain drafts and stale revisions. Direct canonical replacement writes explicitly supply a complete valid target-domain record. Do not build a generic conversion engine.

## Implementation scope and boundaries

The new Step 2 is one coherent fresh-only application replacement, not a staged migration module. An executor may organize edits sequentially, but must not hand off a broken intermediate application or ship dual runtime modes.

**Allowed source/documentation paths:** `src/schema.ts`, `src/database.ts`, `src/objects/{model,runtime,views,http,client,generator,demo,workspace,values}.ts`, `src/objects/render.tsx`, `public/objects.css`, `scripts/sqlite-{fixture,bench,storage}.ts`, directly affected `test/*.test.ts`, `README.md`, `docs/{object-contract,quickstart,sqlite-benchmarks,sqlite-measurements}.md`.

**Retire during implementation after checking importers:**

- `src/objects/upgrade-markdown.ts` and `test/objects-upgrade.test.ts` — obsolete old-format converter/tests.
- `src/objects/upgrade-fixed-domains.ts`, `scripts/fixed-domain-preflight.ts`, `test/fixed-domain-preflight.test.ts`, `test/fixtures/object-schema-v6.ts` — superseded migration-readiness tooling and fixtures.

Replace old-version upgrade success tests in retained suites with nonmutating version-rejection tests. Port current backup/history/content safety tests before removing their generic setup. Keep existing commits; no history rewrite or reset to an earlier branch.

**Out of scope:** all existing `.data/` files and user backups; deleting/resetting databases; original-checkout edits or restarts; provider calls; credentials; dependencies/lockfile/runtime upgrades; merge/push/publication; deleting worktrees; migration/disposition/import tooling; unrelated plans 012/013; notifications, recurrence, synchronization, authentication/workspace redesign; new performance projects; editor/framework/design-system rewrites. Keep `src/pi.ts` resource isolation unchanged. If an additional shared file genuinely needs editing, explain why before expanding scope.

## Execution order

### Step 1 — Retire the old migration requirement

This planning revision records the owner's clean-slate decision. The previous preflight commits remain historical evidence; no further acceptance/repair loop is required for a migration that will not exist. Do not mistake this for acceptance of previously failing probes or permission to delete personal files.

**Verify:** read this version of Plan 027 and the index; baseline remains `ad2e6da`, with only planning edits until implementation begins.

### Step 2 — Implement the fresh-only fixed-domain application

1. **Inventory callers first.** Search generic mutation methods, definition/edge-table SQL, reference/select/input branches and upgrade imports in `src`, `scripts`, `test`. Use the map above; include demo, backup, history, HTTP and diagnostics. Port them together instead of leaving compatibility stubs.
2. **Close the model.** `model.ts` owns the six definitions/fifteen fields and narrowed value/view types. Remove schema-editor draft types and arbitrary definitions. Keep useful existing method/field names when their meaning remains accurate; no naming sweep.
3. **Install fresh/current v7 only.** `schema.ts` creates the current schema transactionally, with no definition tables, no generic built-in protection triggers and no edge provenance column. Preserve strict object storage, closed domain IDs, JSON-object/field-membership guards, positive revisions, Journal real-date/uniqueness guards, immutable view history and FKs. Use small fixed-data-derived checks rather than a general SQL validation framework. Full scalar/range/time-zone validation remains in canonical commands. Reopening a valid v7 database is nonmutating; missing or inconsistent current application structures fail rather than silently reseeding/repairing them.
4. **Reject old files safely.** For existing file-backed workspaces, check the version using a narrowly scoped read-only connection before writable setup/maintenance. Reuse safe path validation; do not add a general preflight analyzer. Versions 1–6, unknown/newer versions, and unversioned partial application schemas fail with an instruction to choose a new database path. Recheck the version in the initialization transaction. Never auto-delete, convert or overwrite. Truly unrelated tables alone do not identify an existing application and must remain untouched during first initialization. Keep fresh schema and demo in one transaction; optimize only after successful initialization. Do not change the default database path to silently conceal old data.
5. **Switch canonical runtime.** Catalog/type/field lookups use code metadata; remove create/rename/attach schema methods and SQL. Enforce domain membership on every create/update/patch/history save. Keep revision checks, receipt-before-defaulting/replay ordering, exact Markdown preservation, history/backlink atomicity, Journal/date/People/day behavior and bounded body-free projections.
6. **Keep only writing links.** Remove structured-reference validation/indexing/incoming restrictions and property provenance in backlinks. Preserve target existence, retained-trash-link behavior, self/mixed-case links, literal search, pagination and unchanged-writing derivation reuse. No automatic conversion of references to Markdown is needed.
7. **Narrow views and generation.** Remove input/reference/select schemas, predicates, options/pickers and prompt instructions. Keep fixed-field validation at submission and every use; publication/capability/revision/current-scope checks remain mandatory. Keep bounded, metadata-only isolated generation, explicit failures and atomic draft/conversation writes. No real provider call is required.
8. **Remove obsolete UI/routes.** Remove Manage types/New type, schema editor forms/routes, reference pickers and input-view controls/state/styles. Retired mutation routes return 404 without writes. Preserve fixed-domain browsing, existing URLs/IDs, native forms, search/link insertion, writing/history, Calendar/People/Favorites and AI conversations. Implement the domain-change confirmation described above using server-derived current data and revision checks, not a client allowlist. Unknown submitted active fields reject; inactive drafts remain drafts. Do not silently discard values on selection, rejection or stale-write reconciliation.
9. **Replace the demo.** Use only the six domains, fixed fields, ordinary Markdown links and supported published views. Include Person. It is bundled content, not an AI fallback. Seed only a genuinely new application database, atomically; reopening an empty/trashed/deleted workspace does not recreate examples.
10. **Port tests and diagnostics, remove dead code.** Delete the retired migration files and their importers. Replace generic test setups with fixed fields/Markdown connections, retaining meaningful current guarantees. Remove obsolete multiple-reference benchmark scenarios and custom-property setup; retain bounded synthetic date/search/storage measurements and exact cleanup. Do not keep mutable schema APIs for benchmarks. Label older measurements historical and update CLI/report documentation to the reduced scenarios. No performance optimization is authorized.
11. **Update user docs.** Describe fixed fields, Markdown-only connections, domain-change confirmation, revised demo and fresh-only version 7. Remove instructions to customize schemas or upgrade old formats. Explain how to select a new explicit path and that existing files are neither migrated nor deleted. Keep backup instructions for future v7 data.

**Verify:** focused schema/runtime/view/HTTP/demo/day/People/Markdown/history/backup/diagnostic tests, `bun run check`, `bun test`, and `git diff --check` all pass. A suggested permanent addition is `test/objects-fixed-domains.test.ts` for the cross-layer fixed-domain contract; adapt existing suites instead of making one oversized duplicate suite. Commit only assigned changes on the isolated branch, then stop for review.

### Step 3 — Review and exercise the actual product

Use a server with an explicitly temporary owned `DATABASE_PATH`, never the default live path. Use Orca's built-in browser; no alternative browser when unavailable. Record actual keyboard/focus/responsive outcomes, not HTTP/jsdom assertions presented as browser proof.

Exercise native forms without JavaScript and enhanced flows: all six domains; invalid/mutually exclusive temporal fields; Task completion/scheduling; Journal duplicate/trash/day conflicts; Person reconnect dates; domain change confirmation/cancel/rejection; history drafts; stale/reconciled/second-conflict saves; exact writing/preview/undo; Markdown link insertion/backlinks; Favorites/Search/People/Calendar; view draft/publication/scoped action/deletion; explicit conversation targeting and unsaved AI prompts. Confirm removed controls/routes cannot mutate schemas. Use injected generation for declarative flows only; do not claim it verifies real Pi/provider integration.

Test keyboard access/focus restoration and desktop/~390px layouts. Capture findings/evidence in `plans/027-review.md` during review. Run TypeScript/full suite/hygiene again. Report unverified cases explicitly; no acceptance by test count alone. Any corrections receive a bounded assignment, not an unrelated redesign.

**Gate:** reviewed diff, passing current-contract tests and genuine Orca browser evidence. Then deliver the isolated commit(s). Merge/push, original-checkout updates, server restart or selection of a real new workspace path still require their own instruction; no historical-data migration gate remains.

## Permanent test requirements

- Fresh v7 initialization and fresh-demo failure rollback; metadata/version written transactionally. Reopen preserves edits, history, receipts, view tombstones, favorites, visitor/conversation state and emptied workspaces.
- Old versions 1–6, newer versions, missing/invalid metadata with application tables, and incomplete v7 schemas refuse without modifying logical data/schema. Use small synthetic legacy markers/sentinels, not a maintained legacy initializer. Test file-backed rejection before writable maintenance and safe-path/link refusal.
- Exactly six supported domains/fifteen fields; unknown IDs and wrong-domain fields reject through domain and HTTP commands. Returned metadata cannot mutate future requests. No schema mutation methods/routes remain usable.
- All domain-specific rules, JSON/key/revision/storage checks, Trash/restore and full previous-state history; canonical writes/backlinks/receipts commit or roll back together.
- Task creation retry after later edits/completion returns the same current object without a write; different request reuse conflicts. Newly created receipts must remain correct even though no old receipts migrate.
- Exact Markdown on initialization/non-writing edits; writing-only backlinks for real links, not code/images/HTML; mixed-case/self/trash targets, missing targets, bounded pagination and stale revision rejection.
- Valid fixed-field views and rejected retired inputs/fields/operators; immutable view history, compatible signatures, source/filter/capability/revision enforcement and object independence from view lifecycle.
- Native/enhanced drafts survive validation, domain selection/change, history recovery and repeated conflicts. Fresh workspace does not mean disposable new edits.
- Recreate the backup test using new v7 objects/Markdown links: committed WAL snapshot, owned new destination, non-overwrite, integrity/FKs, reopen, histories/receipts/views/conversations/visitors and source independence.
- Diagnostic commands remain bounded, synthetic, provider-free, ignore user database paths where required and clean only their own temporary artifacts.

Match the existing test structure:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Use openDatabase() in memory or an owned temporary path; close before cleanup.
```

## Verification commands and done criteria

Existing commands: Bun **1.4.2+**; `bun install --frozen-lockfile` only if needed; `bun run check`; `bun test`; `git diff --check`; `git status --short`. Use `bun test test/objects-schema.test.ts test/objects-runtime.test.ts test/objects-views.test.ts test/objects-http.test.ts test/objects-demo.test.ts test/database-backup.test.ts` for the initial focused set, then the full suite. All must exit 0 after cutover. Do not run a deleted preflight command as an acceptance gate.

Audit with:

```sh
rg -n 'createType|renameType|addProperty|renameProperty|object_types|object_properties|property_id|inputId|upgradeObjectMarkdown|analyzeFixedDomainPreflight' src scripts test
```

Classify remaining matches: negative/version-rejection fixtures may mention retired names, but no active definition-table SQL, schema mutation methods, typed-edge/input query paths or legacy converter imports may remain. Do not require zero matches by deleting useful rejection tests.

- [ ] One active fresh/current-v7 schema and fixed-domain runtime; no migration/compatibility machinery.
- [ ] Unsupported files refuse without reset; existing files remain available and no personal path was touched during development.
- [ ] Current data/transaction/security/draft/backup guarantees pass; retired feature tests are replaced or explicitly removed for a product reason.
- [ ] Demo, scripts and documentation agree with the fixed product.
- [ ] TypeScript, focused/full tests, hygiene, reviewed caller inventory and actual browser flows pass.
- [ ] Final report states commit(s), changed paths, exact verification, remaining limitations and no inferred merge/push/live-file action.

## STOP conditions and maintenance

Stop on unknown edits, a schema-version collision, a needed out-of-scope file, lost current-product data/drafts, or inability to refuse old databases without automatic modification. Do not build migration tooling because an existing development file is inconvenient; use a new owned test path. Never disable checks, reset data, delete owner files, weaken request/SQLite/model security, or keep a generic shadow runtime to make tests pass. After two focused failed repair attempts, report and preserve the work.

Future data will matter even though there is no production data today. Maintain explicit format versions, safe backups, atomic writes, history, receipts and refusal of unsupported formats. Future fixed-field evolution can receive its own appropriately scoped migration if real data then needs it; do not prebuild that framework now. This plan does not audit dependencies, run providers, inspect personal data or prove browser behavior during drafting.
