# Object workspace contract

This document replaces the app-owned record contract. Its historical filename remains for documentation links. The implementation schema is `src/objects/model.ts`; SQLite is the sole live authority.

## Data model

- **Object:** stable UUID, type ID, independent title, property values keyed by property ID, structured document, revision, timestamps, and trash flag.
- **Type:** stable UUID, name, ordered recommended property IDs, and revision. No inheritance. Objects may retain registered properties outside their current type.
- **Property:** stable UUID, label, kind, revision, and kind-specific metadata. Reusing a property shares its ID; creating another property with the same label does not.
- **Document:** validated ProseMirror JSON with stable block IDs, bounded size/depth, safe links, and object-link atoms. Object/property references and document mentions produce derived backlinks with provenance.
- **View:** independent ID, revision, draft/published status, declarative spec, prompt, provider/model, timestamps, and immutable view revision history. Deletion records a tombstone and never deletes objects.
- **View conversation:** visitor-owned successful prompt/result turns. Its latest result supplies the next refinement spec; navigating the workspace never retargets the conversation. Generated drafts and successful turns commit atomically.

Page is the initial writing type. Titles are independent of document headings. Trash/restore and property updates retain object identity. Type changes are rejected if they would invalidate incoming typed references.

## Property values

| Kind | Representation |
| --- | --- |
| text | String |
| number | Finite numeric value; integers must be safe |
| boolean | Boolean |
| date | Real `YYYY-MM-DD` date |
| datetime | ISO timestamp with seconds and explicit `Z` or offset |
| select | Stable option ID; labels are presentation |
| reference | Object ID, or a unique array of IDs when multiple |
| date-range | `{start,end}` with exclusive end |
| time-range | `{start,end,timeZone?}` with explicit offsets and exclusive end |

A new reference property requires a target type; single/multiple shape is fixed at creation. References to trashed objects may be retained, not newly added. Invalid values reject the whole write.

`updateObject` replaces properties and document at the expected revision. `patchProperties` merges a patch, with null removing a property. Stale revisions return conflict. Creation request IDs are idempotent for matching semantic content and reject different reuse. Prior object states are retained in revision snapshots.

## Structural view compatibility

A view contains one to six blocks. Each block selects a trusted component and one to eight source types. Every source explicitly maps semantic roles to stable property IDs. A property used in a source binding, filter, or ordering must be assigned to that source type. A type occurs at most once per block; distinct projections belong in separate blocks.

| Component | Required contract | Optional write command |
| --- | --- | --- |
| list | Explicit bindings for any declared columns | None |
| table | Explicit columns and bindings for every column | None |
| calendar | `date` bound to date, datetime, date-range, or time-range | Patch the bound date |
| board | `group` bound to single-valued text, select, boolean, or reference | Patch the bound group |

Objects always provide an independent title/link. Different types can bind different compatible properties to the same role. Matching labels, inheritance, or copying records are unnecessary. Missing dates and groups remain visible as Unscheduled/Ungrouped unless a filter deliberately excludes them.

Calendar rendering is an agenda grouped by the stored start date. Ranges display start/end; filtering and ordering operate on their start. It does not expand recurring events or ranges into a month grid.

## Queries and inputs

Filters support equals, notEquals, contains, before, after, empty, and notEmpty with kind-checked operands. Select comparisons use option IDs. Text contains is a literal substring; multiple-reference contains is membership. Ranges support temporal comparisons, not whole-range equality. Missing values, empty strings, and empty reference lists are empty; false and zero are present. notEquals excludes empty values.

A parameterized input has a label and object type. Every source must contain an input-bound reference filter. Missing input returns no records. Invalid, trashed, or wrong-type input rejects. This contract is also checked on every command.

Prepared SQL binds comparison values and uses only validated property IDs in generated paths. Each block reads at most 101 rows, displaying 100 plus a truncation notice. Ordering is source-major, then the optional source property, then title/ID; missing sort values are last. Datetime comparisons use instants, not offset-string ordering. Reference UUID comparisons are case-insensitive.

## Commands are not compatibility

Only a published block with `editable:true` can expose its supported date/group command. Drafts and list/table blocks cannot use inline mutations. Object-editor links remain available independently.

A command transaction checks view revision, publication, current structural compatibility, block capability, object revision, source membership, filters, input scope, and trash state. It then calls the same typed property command used by the object runtime. No model-authored endpoint or arbitrary property write is executed.

A shared label rename does not change the compatibility signature. A kind/reference-shape change through a future schema migration makes an old view incompatible rather than silently reinterpreting it.

## AI boundary

Generation receives a deliberate projection of type/property metadata plus the current user prompt, up to 12 earlier conversation prompts, and, for refinement, the prior spec. It does not read object titles, documents, records, the filesystem, the shell, or arbitrary network resources; users can still include their own content in prompts. Pi's isolated session has only `submit_view`, not object-mutation tools. The current request takes precedence over historical prompt context.

`submit_view` performs structural and semantic validation. Generation is bounded by a 45-second deadline, six tool attempts, and eight assistant messages. Accepted submission stops generation. Provider failure, timeout, cancellation, or invalid output does not create a fallback view. The server validates again before saving the draft. Refinement creates a new draft and leaves the old view untouched.

The browser only submits prompts and lifecycle/actions, never an arbitrary spec. Trusted JSX renders declarative components; generated HTML, JavaScript, SQL, plugins, and scripts are not part of the contract.

## Persistence and migration

`ObjectRuntime` initializes versioned object tables and performs legacy migration transactionally. Newer unknown schema versions are refused. Canonical object writes, revision snapshots, and derived edges commit together. Foreign keys, WAL, and full synchronous durability are configured by `openDatabase`.

Legacy migration reads owner records directly from existing SQL regardless of old app grants, assigns stable type/property/option identities, preserves object IDs and source data, translates resolvable links, and derives reference edges. Unknown structured or mixed metadata is retained as reversible JSON text with an encoding map. Ambiguous links remain prose. Unsupported data rolls back initialization instead of silently dropping records. Original app tables are archival, not a second authority; legacy runtime startup refuses a migrated database.

The live HTTP surface is `/`, `/calendar`, `/tasks`, `/types`, `/objects`, `/properties`, and `/views`. `/calendar` lists calendar-containing saved views; `/tasks` browses an existing Task or Tasks type without creating one. `/views/generate` accepts a prompt and either a previous view ID or a conversation ID, never both. Enhanced clients request JSON; native clients receive a redirect. `/views/conversations/:id` returns successful turns only to their visitor cookie. The old `/vault` surface is retired. Historical issue-conversation workspaces remain a separate experiment and do not act on canonical objects.

## UI and limits

Native server-rendered forms are the baseline. Progressive enhancement supplies save feedback, dirty-form protection, generation progress, and ProseMirror editing. A no-JavaScript Markdown fallback preserves object-link targets. Rich images render as text placeholders; unsafe links and malformed/deep documents reject.

The desktop shell separates persistent left navigation, main content, and a collapsible/resizable right view assistant. Generated previews render in the main area. Smaller screens use AI and navigation drawers with keyboard focus containment and Escape dismissal. An active conversation and unsent prompt remain in browser tab storage across navigation and panel closing; successful turns remain in SQLite. Pinning and panel width are local browser preferences, not view definitions. Generation completion does not navigate away from unsaved object edits. Deleting a conversation’s latest view blocks further refinement with a clear error rather than silently choosing another target.

Object browse pages contain 50 records, with bounded literal search. Pickers contain at most 200 candidates plus existing selections when needed. Documents are limited to 256 KiB, 10,000 nodes, and depth 32. The service is loopback-only and single-owner: cookies isolate conversation histories, not shared objects or saved views. CSRF and origin/host checks are not a substitute for multi-user authentication.
