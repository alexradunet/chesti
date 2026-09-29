# Plan 027 — checkpoint 1 review

## Delivery and verdict

- Executor commit: `c3d58b4887d9c8b181dfab9ba5e131db1f811719`.
- Scope: four new preflight/fixture/test files; original source unchanged.
- Independent verification: strict TypeScript, 176 tests / zero failures, diff hygiene pass.
- Verdict: **REVISE — correction round 1 of at most 2. Do not begin Step 2.**

Passing tests do not currently establish the promised fail-closed boundary. The supposed compatible fixture contains incompatible views and an extra writing edge, so it conceals rather than tests preservation requirements.

## Confirmed blockers

### 1. View semantics and signatures are not validated

`validateView` checks TypeBox shape and allowed field IDs only. It never compares schema signatures or runs component/role/operator/source-uniqueness semantics. The compatible fixture's calendar repeats Event and Reminder in one block; the existing `validateViewSpec` rejects it with “Each type may appear once per block.” Nevertheless preflight reports compatible. Every fixture view also stores a made-up object-shaped signature instead of the actual sorted tuple representation `[fieldId, kind, multiple, targetTypeId]`.

Repair: use the canonical semantic validator with fixed built-in metadata (and explicit no-input/reference restrictions), verify the exact supported signature, fix the frozen fixture to contain valid independent calendar blocks and genuine signatures, and retain negative tests for invalid roles/operator operands, duplicate source kinds, incorrect signatures, and unsupported data appearing only in view history/deleted views. Do not mutate immutable view history to create a fixture; construct it correctly before installing guards.

### 2. Incomplete historical records pass

An independent in-memory probe replaced a task snapshot with `{typeId: PAGE_TYPE_ID, properties: {}}`. Preflight still returned compatible. It checks neither body/title/identity/revision/timestamps/trash nor correspondence to the row key. Current objects likewise are scanned only for type/properties; their writable shape/Markdown bounds and dates/revisions are not checked.

Repair: validate full historical/current record shape and correspondence, preserve exact body and all scalar values, scan all history including Trash, validate receipt identifiers/digests/target integrity, and verify missing-vs-present fields deliberately. Diagnostics must not print record content through malformed IDs or raw values. Add meaningful malformed-record/receipt tests beyond invalid Journal date.

### 3. Writing-edge preservation is absent

The “compatible” fixture inserts a self-edge not present in its Page Markdown. No comparison with extracted Markdown links occurs. Missing, spurious, and invalid-target edges all risk a falsely approved later conversion.

Repair: fixture writing and writing edges must agree; validate per-record extracted link targets and case-insensitive edge-set equivalence, without fetching unrelated full bodies or unbounded edge arrays. Add missing/spurious/self/mixed-case/trash link tests. Structured edges still block independently; do not convert them to Markdown.

### 4. Extra data/schema dependencies pass

Independent probes each returned compatible after:

- adding `objects.extra_saved_data TEXT` and storing a sentinel;
- creating an unrelated table with `REFERENCES object_types(id)` and a live dependent row.

`validateApplicationShape` checks only required column names and custom trigger/view SQL. It ignores extra columns, table constraints/types, external FKs, custom indexes, and altered DDL under a known schema-object name.

Repair: reject unsupported application shape and inspect dependencies using SQLite schema/pragma metadata, not only a broad regex over trigger/view names. Preserve truly unrelated tables. Cover extra/generated columns, changed constraints/known-name triggers, and unrelated-table references to tables being removed/rebuilt. Do not create a general SQL parser; use conservative known-shape checks and explicit blockers.

### 5. Analysis mutates its supplied connection

`analyzeFixedDomainPreflight` permanently sets `PRAGMA query_only=ON` and `foreign_keys=ON`. The independent probe starts query_only=0, runs analysis, then cannot update even an unrelated sentinel (“attempt to write a readonly database”). This prevents safe reuse inside the future write transaction.

Repair: the CLI owns readonly/trusted-schema setup; shared analysis must not permanently change connection settings. It must support a consistent read transaction standalone and reuse inside the migration's existing transaction without damaging its state. Verify settings and subsequent write/rollback behavior on success and failure. Never open a writer from the CLI.

### 6. Boundedness, path safety, and exit contracts have gaps

- FK errors are `.all().slice(0,5)` and counted only after slicing, so totals/truncation are false and reads unbounded. Definitions also load all rows at once. Add >batch-size and >sample-limit tests that assert full totals with bounded samples.
- `checkedPath` rejects only a final symlink; a symlink parent directory is resolved and accepted, unlike the existing safety contract. Add ancestor-symlink/hardlink cases.
- Raw errors/unknown ID strings can leak stored text through reports. Sanitize IDs/reasons from malformed data and errors; never dump database contents. Test sentinel text placed in malformed identifiers/body-related records, not merely normal fields.
- Distinguish malformed/unreadable/unsupported (CLI exit 1) from valid-but-incompatible/upgrade-needed (exit 2); make this a structured result rather than searching diagnostic prose for “unsupported.” Add all exit paths and complete no-mutation row/schema/mode checks, not only a comparison of table names.

### 7. Frozen fixture is not a genuine v6 structural baseline

The fixture omits actual built-in protection and Journal guards, omits current structural constraints, and imports current `BUILTIN_TYPES/PROPERTIES` arrays and current fingerprint generation. These will drift with the new model and can make migration tests agree with the implementation's own mistake.

Repair: freeze genuine baseline-v6 DDL/definitions and fixed receipt evidence independently of the evolving runtime. Keep expected literal digest plus an independently checked creation payload; compare with the current canonical API now while it still represents v6. A minimal metadata-only older-version fixture is fine for rejection/reporting, but do not describe a relabeled v6 database as a genuine v5 migration fixture.

## Requested correction scope

Same four files only (unless a narrowly needed shared validation export is proposed first). No active schema/runtime/UI changes, no destructive DDL, no extra writer, no live database. Correct the false-positive boundary without building a generic migration framework. Remove unused imports/dead helpers while touching these files and prefer readable multi-line logic.

Run focused tests, `bun run check`, full `bun test`, diff hygiene; commit on the same isolated branch and pause for review. Report explicitly any requirement still unmet. This is a preflight gate, not full implementation acceptance.
