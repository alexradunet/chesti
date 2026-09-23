# Markdown app contract — draft v0.1

This is the implemented definition, validation and execution contract. The read-only CLI validates candidates; the application separately approves exact revisions and grants, executes declared record operations, and presents Today through the existing conversation/browser boundary. Migrations, file watchers and conversational app creation are not implemented.

## Quick start

From the repository root:

```sh
bun scripts/lifeapps.ts check examples/life-vault
bun scripts/lifeapps.ts check examples/life-vault --json
bun scripts/lifeapps.ts schema
```

The existing Node setup works too:

```sh
npm run lifeapps -- check examples/life-vault
node --import tsx scripts/lifeapps.ts check examples/life-vault --json
```

See [the short guide](vault-quickstart.md) and the real definitions in [`examples/life-vault/.apps/`](../examples/life-vault/.apps/).

## What is authoritative

- Documents are UTF-8 Markdown files. The reader retains their complete original source, body and a SHA-256 content revision. It never serializes a document back to disk.
- App definitions are Markdown files under `.apps/`. Frontmatter holds the contract; the body is explanatory prose, not executable rules.
- A valid definition is an **eligible candidate**, not a permission grant. The browser review page binds selected capabilities to its path and SHA-256 revision. External changes suspend the app pending review; the agent cannot approve it.
- No search database is created. Each resolution reads a fresh disk snapshot. Private runtime state stores approvals and receipts, not a replacement for the Markdown documents.
- The scanner requires an explicit root containing a real `.apps/` directory. An empty `.apps/` directory is permitted for a notes-only vault. It does not search home directories, installed LifeOS data or ancestor directories for a vault.

## Source format

Frontmatter, when present, begins on the first line with `---` and ends with another `---` line. UTF-8 BOM and CRLF are supported and preserved. A first-line delimiter reserves this syntax for frontmatter, even in an otherwise plain note.

The frontmatter root must be a mapping. YAML 1.2 core parsing keeps dates as strings; there is no implicit Date-object conversion. Duplicate keys, non-string mapping keys, aliases, anchors, explicit tags, merge keys, nonfinite numbers, unsafe integers, and object-prototype keys are rejected. Empty frontmatter is valid in an ordinary note.

Content uses CommonMark parsing for the first level-one heading and link locations. The reader additionally recognizes Obsidian-style `[[wiki links]]` and `![[embeds]]` in text. Inline/fenced/indented code, HTML nodes and normal Markdown link nodes do not produce wiki-link diagnostics. There is no requirement for headings, checklists, prose structure or a journal template. This is not a Markdown renderer or a complete Obsidian/GFM compatibility layer.

## App shape

The formal schema is exported as `AppDefinitionSchema` and `appJsonSchema` from `src/vault/schema.ts`. `lifeapps schema` prints the JSON Schema for editor integration without maintaining a second generated copy. JSON Schema validates shape; the shared validator also performs semantic and vault-wide checks.

Required root properties:

| Key | Purpose |
| --- | --- |
| `contract` | Exactly `lifeapps/v1` |
| `id` | Stable lowercase app identifier; letters, digits and hyphens |
| `name` | Human-readable name |
| `types` | Local document type definitions |
| `collections` | One or more typed collection declarations |
| `views` | Named presentation declarations |

`description` is optional. Unknown definition keys are errors. Maps, arrays and names have finite schema limits. IDs and type names are not filenames.

A type declares:

```yaml
version: 1
storage:
  defaultFolder: Inbox/Tasks
fields:
  status:
    type: enum
    values: [open, active, done]
    required: true
    default: open
  due:
    type: date
actions:
  complete:
    operation: record.update
    when: {field: status, in: [open, active]}
    set: {status: done}
```

The document's qualified type is `<app-id>.<local-type>`, such as `tasks.task`. Storage is a **creation location hint**, not a membership boundary or filesystem permission. Existing typed records can be in Projects, Archives or any visible vault folder. Default folders must be relative and cannot include dot segments, hidden folders, backslashes or reserved path characters.

### Fields

Supported types:

| Type | Value |
| --- | --- |
| `text` | String |
| `number` | Finite JavaScript number; integers must be safe integers |
| `boolean` | YAML true/false, not a string |
| `enum` | One of the explicitly declared strings |
| `date` | Real Gregorian `YYYY-MM-DD`, years 0001–9999 |
| `datetime` | ISO date-time with seconds, optional 1–3 fractional digits and explicit `Z` or `±HH:MM` offset |
| `date-range` | `{start, end}` dates, strictly ordered, with exclusive end |
| `time-range` | `{start, end, timeZone}`; ordered date-times with offsets matching the IANA zone at each instant |
| `reference` | A document UUID plus a declared `target` qualified type |

An offset is not silently inferred from the machine timezone. Time ranges validate DST at both endpoints; named zones are checked with the runtime's Intl timezone data. Bare local timestamps, unknown `-00:00` offsets, reversed ranges and nonexistent calendar dates are errors. Date-time precision is milliseconds; leap seconds are outside this contract.

A field may have `required` and `default`. Creation applies declared defaults to omitted fields; existing documents are never silently defaulted. Optional fields may be absent; `null` is invalid stored metadata. An explicit `null` in an update request removes an optional declared field without touching unrelated metadata.

Reserved names: `id`, `type`, `schema`, `title`, `body`, `path`, `revision`. App-defined fields cannot overwrite these. `title` and `body` are string fields available to actions and queries without declaration.

### Actions

Only two operation names are recognized in this draft:

- `record.create`
- `record.update`, with a nonempty `fields` allowlist and/or nonempty fixed `set` values

An update may include `when`. A field cannot be both caller-editable and fixed. The runtime enforces current predicates, the field allowlist, fixed values, and explicit type-level create/update grants. `requiresConfirmation` creates a pending conversational receipt; a native action submit or receipt confirmation is the explicit browser action.

The executor supports only these two operations: no deletion, arbitrary code, shell, plugins, network access or background scheduling. Creation assigns a server UUID and a filename inside the declared default folder; callers cannot choose paths or envelope fields. Before publication, the resulting Markdown and prospective vault state are validated for types, references, uniqueness and cross-field rules.

### Queries and views

A collection declares its local `type`, optional `where`, and optional `orderBy`.

Predicates are exactly `{field, equals}` or `{field, in: [...]}`. Values must match the field type. No expressions, SQL, scripts, comparison functions, nested boolean expressions or dynamic context variables are supported. Range equality and range ordering are intentionally unsupported.

Sorting uses `ascending`/`descending`, with optional `missing: first|last`.

Views declare a collection and `list`, `table` or `calendar`. A calendar maps a temporal `date` field and a text/enum `label`. The resource adapter executes declared predicates and ordering; multiple calendar views contribute projections of the same file. Today and the calendar agenda display dates and local times, including overlapping ranges and exclusive ends. A deadline and a scheduled session may intentionally appear as distinct projections.

### Cross-field and uniqueness rules

- `uniqueBy: [[date]]` declares uniqueness within a qualified document type. Composite scalar keys are allowed. Each member must be a required scalar field. Reference IDs are case-insensitive and date-time keys compare actual instants.
- `rules: [{kind: exactlyOne, fields: [day, when]}]` requires exactly one of those individually optional fields to be present. The sample calendar uses this for all-day versus timed events.

## Managed document shape

```markdown
---
id: 550e8400-e29b-41d4-a716-446655440002
type: tasks.task
schema: 1
status: open
due: 2026-09-25
---
# Publish homepage

Free-form writing belongs here.
```

- `id` is a UUID, unique across the vault. Moving the file does not change it.
- `type` resolves through a valid candidate definition. Missing or invalid definitions make structured interpretation invalid; no cached schema is silently used.
- `schema` must equal the type's declared version. Migration is never implicit.
- `title` is the first H1 heading, otherwise the filename without `.md`; no duplicate frontmatter title is accepted for managed records.
- `body` is the complete Markdown body, including any title heading. Title edits replace the first H1 (or insert one if absent); they do not add a second frontmatter source of truth.
- Undeclared metadata generates a warning and is retained unchanged. Reserved runtime fields in managed frontmatter are errors.
- Plain notes need no frontmatter. An `id` or `schema` without `type` is a partial managed envelope and is reported as an error.

The sample journal requires one record per date for its qualified type. Multiple journals would need distinct types or an explicit schema evolution to a composite key; the validator never creates journal entries just because a date is viewed.

## Relationships

Structured references use UUIDs and validate the target's type and validity. Missing, duplicated, invalid or wrong-type targets are errors. Invalidity propagates through reference chains; valid cycles are permitted.

Wiki links are navigation, not typed foreign keys. They support:

- Exact vault-relative paths, optionally omitting `.md`.
- Explicit `./` or `../` paths relative to the source file, while staying in the visible vault.
- Unique filename matches for bare names, after checking for an exact root match.
- `[[Page#Heading|Label]]` and attachment filenames for embeds.

Missing or ambiguous files produce warnings. Heading/block fragment existence is not checked yet. Absolute paths, URLs and attempts to leave the visible vault produce warnings and are never fetched. Link resolution is case-sensitive; neither fuzzy title matching nor automatic rename repair is performed.

PARA classification is derived from folder location conceptually; no duplicate `paraCategory` field is introduced. This reader does not force every document into PARA or equate moving to Archives with completing a task.

## Diagnostics and safety

The public report is `{contract: "lifeapps/check-v1", valid, counts, diagnostics}`. Each diagnostic includes a stable code, severity, vault-relative file, line, column and message; field paths and related files are added where applicable. JSON reports omit document bodies, but filenames and diagnostics may still be private. Do not publish them indiscriminately.

Errors invalidate the report. Warnings permit a successful check. Invalid parsed files remain available in the in-memory snapshot with their original source and diagnostics. Unreadable, oversized or invalid-UTF-8 files cannot be parsed and are represented by scan diagnostics. No file is overwritten or quarantined.

Limits are 10,000 directory entries, 1 MiB per Markdown file, 32 MiB total Markdown and depth 32. Hidden paths are skipped except `.apps`; `node_modules` is skipped. Symlinks are reported, never intentionally followed. Normal files are opened read-only, with no-follow/nonblocking flags; containment, identity, size and change metadata are checked. Incomplete scans fail rather than report success.

The runtime adds no-follow path checks, rejects hard-linked targets, validates two fresh vault scans, and checks record/definition hashes immediately before publication. Updates use atomic rename; creation uses no-clobber publication. This remains **single-process**, not a sandbox against a hostile process racing directory swaps or the final check-to-rename window. A whole-vault snapshot is not transactional across concurrent external writers.

## Library entry points

- `parseMarkdown(path, source)` — syntax, body, title, source revision, wiki links, locations.
- `validateDefinition(file)` — schema and local semantic checks.
- `validateRecord(file, types)` — one document against a provided type registry.
- `validateRecordRelationships(documents)` — ID, uniqueness and typed-reference checks.
- `readVault(root, limits?)` — bounded scan and complete validation snapshot.
- `runCli(args)` — deterministic CLI result without process-global effects.
- `VaultRuntime(root, stateFile?)` — review/approve exact definitions, approved snapshots, declared mutations and durable receipts.
- `vaultResolver(runtime)` / `mutationFor(...)` — common resource discovery and typed action conversion for browser forms and conversation.

The CLI, HTTP handlers and Pi tools reuse the same parser and validators. Pi only receives `inspect`, `act`, and `present`; it cannot choose an arbitrary filename or call the approval route. Forms and tools both enter `VaultRuntime.execute` through persisted action receipts.

## Approval, revisions and receipts

`read:<qualified-type>`, `create:<qualified-type>` and `update:<qualified-type>` are separately selected grants. Wiki can additionally offer `notes:read` for ordinary notes throughout the visible vault. Review shows exact source and individual unchecked permissions. Reapproving with fewer permissions removes the others.

The default authority file is `<vault>/.lifeapps/runtime.json`, outside the visible scan. It contains accepted definition path/revision/grants, idempotent request fingerprints/results, and at most one pending publication journal. An optional explicit authority path must also be outside the visible scan. The configured vault/grants are shared by local browser sessions; this is not multi-user access control.

Create requests bind the definition revision. Updates bind the record content hash; browser/tool requests additionally bind the definition revision so a stale confirmation cannot execute changed fixed values after reapproval. Action IDs and caller fields must be advertised and declared. Repeated runtime request IDs replay the same receipt; changed inputs under the same ID fail.

Untouched YAML tokens (including comments, unknown metadata and CRLF/BOM) and Markdown are retained. An explicit body replacement replaces only the body. Staging and authority writes are fsynced; receipt recovery compares the published file's content hash and never replays a write over later external edits. The conversation store records intent before calling the vault runtime and reconciles interrupted receipts on restart.

State is bounded to 16 MiB and 10,000 mutation receipts; capacity exhaustion rejects new writes. Back up authority state with the Markdown files rather than deleting it to clear capacity: deleting it also removes grants and receipt history. Invalid approved-readable records are not exposed as actionable resources; their diagnostics remain visible in Today.

## Still to build

Migrations, filesystem watching, multi-process coordination, richer calendar layouts and Pi-driven app creation. Newly generated definitions will remain candidates until the same explicit approval boundary is used.
