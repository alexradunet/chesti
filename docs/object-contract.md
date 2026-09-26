# Object workspace contract

The implementation schema is `src/objects/model.ts`; SQLite is the sole live authority.

## Data model

- **Object:** stable UUID, type ID, independent title, property values keyed by property ID, Markdown body, revision, timestamps, and trash flag.
- **Type:** stable UUID, name, ordered recommended property IDs, and revision. No inheritance. Creating a type based on another copies its current ordered property IDs, without a live parent relationship or copied objects. Objects may retain registered properties outside their current type.
- **Property:** stable UUID, label, kind, revision, and kind-specific metadata. Reusing a property shares its ID; creating another property with the same label does not.
- **Writing:** the submitted Markdown string is stored without server-side reformatting, bounded to 256 KiB of UTF-8. Enhanced formatted-writing edits may normalize Markdown before submission; editor state is transient and never stored as JSON. Parsed local Markdown links produce one writing backlink per source/target pair; property backlinks retain their property identity. Local object UUID links are case-insensitive. Code examples, images, and raw HTML do not create backlinks. There are no editor-specific block IDs.
- **View:** independent ID, revision, draft/published status, declarative spec, prompt, provider/model, timestamps, and immutable view revision history. Deletion records a tombstone and never deletes objects.
- **View conversation:** visitor-owned successful prompt/result turns. Its latest result supplies the next refinement spec; navigating the workspace never retargets the conversation. Generated drafts and successful turns commit atomically.

All objects have an independent title and Markdown writing. Trash/restore and property updates retain object identity. Type changes are rejected if they would invalidate incoming typed references.

### Protected built-ins

Built-in identities and core property definitions are declared in `src/objects/model.ts`, not inferred from editable names. SQLite protects their deletion, identity, core attachments, and property shapes. Display names and labels remain editable, and additional fields may be attached. Existing user-created types with matching names remain separate and unchanged.

| Type | Core properties | Canonical rule |
| --- | --- | --- |
| Page | None | Generic writing |
| Task | Done (boolean), Due date (date) | Missing Done becomes false; due date is optional |
| Event | All-day dates (date-range), Event time (time-range) | Exactly one range must be present |
| Reminder | Reminder date (date), Reminder time (datetime) | Exactly one must be present; no notifications or recurrence |
| Journal | Journal date (date) | Required real date; one canonical journal per day |

Built-in semantic rules apply through all canonical object writes, including published view commands. Copies of built-in types share property identities but do not inherit these rules or later field additions. Reusing a property does not copy any object values.

Journal uniqueness includes Trash and is enforced by a SQLite unique index; storage guards reject missing or invalid journal dates. `getJournal(date)` never writes. `openJournal(date)` atomically returns the existing object, including a trashed one, or creates an empty Journal titled with that date. It never restores, overwrites, or merges writing. Ordinary creation of a second Journal for the day returns 409, preserving the submitted draft. Changing a journal date rejects an occupied destination before writing revisions or backlinks. Journal dates are independent of titles and creation timestamps.

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

`updateObject` replaces properties and Markdown body at the expected revision. `patchProperties` merges a patch, with null removing a property. Stale revisions return conflict. Creation request IDs are idempotent for the same type, title, property values, and exact submitted Markdown, and reject different reuse. Prior object states are retained in revision snapshots.

Task completion normalization happens after creation-request fingerprinting: receipts still describe the submitted content, and replaying an earlier creation request cannot reset a subsequently completed task.

Conflict recovery never silently advances the submitted revision. The native update form may explicitly submit `reviewedRevision` after displaying the latest saved object alongside the retained draft. Both the original revision and the reviewed revision must be valid; the reviewed value becomes the exact expected revision for the same domain command. Another intervening save rejects the whole write. There is no automatic field merge or force-save path.

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

To display both temporal representations of Event or Reminder, use separate blocks with a `notEmpty` filter on each bound property. This avoids showing the other representation as a duplicate Unscheduled row; Task due dates remain optional. An inline date command can reschedule its bound field, but switching between mutually exclusive fields requires an object-editor write that clears one and sets the other together. New workspaces include a bundled demo calendar; ordinary object creation never generates a view.

## Queries and inputs

Filters support equals, notEquals, contains, before, after, empty, and notEmpty with kind-checked operands. Select comparisons use option IDs. Text contains is a literal substring; multiple-reference contains is membership. Ranges support temporal comparisons, not whole-range equality. Missing values, empty strings, and empty reference lists are empty; false and zero are present. notEquals excludes empty values.

A parameterized input has a label and object type. Every source must contain an input-bound reference filter. Missing input returns no records. Invalid, trashed, or wrong-type input rejects. This contract is also checked on every command.

Prepared SQL binds comparison values and uses only validated property IDs in generated paths. Each block reads at most 101 rows, displaying 100 plus a truncation notice. Ordering is source-major, then the optional source property, then title/ID; missing sort values are last. Datetime comparisons use instants, not offset-string ordering. Reference UUID comparisons are case-insensitive.

## Commands are not compatibility

Only a published block with `editable:true` can expose its supported date/group command. Drafts and list/table blocks cannot use inline mutations. Object-editor links remain available independently.

A command transaction checks view revision, publication, current structural compatibility, block capability, object revision, source membership, filters, input scope, and trash state. It then calls the same typed property command used by the object runtime. No model-authored endpoint or arbitrary property write is executed.

A shared label rename does not change the compatibility signature. A kind/reference-shape change through a future schema migration makes an old view incompatible rather than silently reinterpreting it.

## AI boundary

Generation receives a deliberate projection of type/property metadata, including canonical built-in identity and core property IDs, plus the current user prompt, up to 12 earlier conversation prompts, and, for refinement, the prior spec. It does not read object titles, documents, records, the filesystem, the shell, or arbitrary network resources; users can still include their own content in prompts. Pi's isolated session has only `submit_view`, not object-mutation tools. The current request takes precedence over historical prompt context.

`submit_view` performs structural and semantic validation. Generation is bounded by a 45-second deadline, six tool attempts, and eight assistant messages. Accepted submission stops generation. Provider failure, timeout, cancellation, or invalid output does not create a fallback view. The server validates again before saving the draft. Refinement creates a new draft and leaves the old view untouched.

The browser only submits prompts and lifecycle/actions, never an arbitrary spec. Trusted JSX renders declarative components; generated HTML, JavaScript, SQL, plugins, and scripts are not part of the contract.

## Persistence

`ObjectRuntime` initializes versioned object tables transactionally. Newer unknown schema versions are refused. Canonical object writes, revision snapshots, and derived edges commit together. Foreign keys, WAL, and full synchronous durability are configured by `openDatabase`.

The object workspace is the only supported data model. Schema version 3 installs the five built-in types, seven core properties, structural protection guards, and daily-journal date constraints transactionally. Version-2 upgrades preserve existing objects, identities, revisions, labels, extra fields, receipts, and same-named custom types. Incompatible reserved IDs fail rather than overwrite data. Startup never resets later customizations.

Application startup uses `openWorkspace` to wrap first schema initialization and demo seeding in one immediate transaction. An existing `object_metadata` or `objects` table identifies an existing workspace; an empty object collection is not a seeding signal. The low-level `ObjectRuntime` remains schema-only. Demo objects, property attachments, backlinks, trash state, and three published views are created through the normal runtime and view commands, never direct fixture inserts. A failure rolls back the whole first initialization. Existing workspaces and upgrades are never seeded or reset.

The demo uses only the five built-in types, all nine ordinary property kinds, Markdown links, and list/table/calendar/board specifications, including reference-scoped input. Its view provenance is `built-in/demo`: bundled content, not a model response or generation fallback. There are no demo conversations, automatic provider calls, extra rendering primitives, or special write permissions. Dates are based on the server-local initialization day, with explicit UTC timed examples, and do not shift on later starts. Trashing examples or deleting views does not cause reseeding.

Version-1 databases first upgrade supported writing and historical snapshots to Markdown, rebuilding writing backlinks at object level and retaining original creation content in receipts. IDs, object revisions, timestamps, views, and visitor identities remain unchanged. Unsupported structures abort the entire upgrade. Startup does not import historical issue/vault data, scan directories, or delete unrelated tables/files. Visitor identity and CSRF state are stored directly in `browser_visitors`.

Version-1 empty paragraphs retain Markdown blank-line source, including inside quotes and lists. Hard breaks use whitespace syntax, with inline marks closed around them so terminal breaks do not become visible backslashes. Standard Markdown may collapse empty editor layout; text, links, revision history, and original creation receipts are preserved. Unknown nodes and malformed or otherwise unsupported structures still roll back the entire upgrade.

The HTTP surface is `/`, `/calendar`, `/tasks`, `/journal`, `/types`, `/objects`, `/properties`, and `/views`. `/calendar` lists calendar-containing saved views; `/tasks` resolves the canonical Task ID even after renaming. `GET /journal?date=YYYY-MM-DD` is nonmutating; CSRF-protected `POST /journal/open` opens or creates that explicit day and redirects to its object editor. Default Today uses server-local dates natively and browser-local dates with enhancement; explicit dates and submitted drafts take precedence. `/views/generate` accepts a prompt and either a previous view ID or a conversation ID, never both. Enhanced clients receive JSON; native clients receive a redirect. `/views/conversations/:id` returns successful turns only to their visitor cookie. There are no issue-workspace or vault routes.

## UI and limits

Native server-rendered forms are the baseline; the HTTP contract accepts Markdown `body`, never editor JSON. With JavaScript, an optional same-origin Milkdown/ProseMirror bundle enhances the source field into directly editable formatted content with native toolbar controls, CommonMark/GFM, and undo/redo. Initialization, title/property-only saves, and undo-to-initial saves preserve the original source exactly. Formatted edits may normalize Markdown delimiters, references, whitespace, and empty layout blocks. Unsupported or lossy imports retain the native source with an explanation; unsupported pasted text stays literal rather than being silently discarded. Before submission, the final Markdown payload, including retained link definitions, is bounded and reparsed; a content-changing round trip rejects the save with an explanation and preserves the live editable draft. No external clipboard HTML/files are imported. Native saving does not wait for the optional editor bundle, and late initialization never overwrites active source editing. Browser-native submissions may normalize line endings.

Saved writing renders through Bun Markdown with raw HTML disabled and link/image rewriting: safe http/https/mailto/local-object links remain clickable, unsafe targets become text, and images become inert placeholders. The same safe-link policy is applied in formatted editing, without relaxing CSP or loading image URLs. Native fallback provides a saved reader, not a live draft preview. Progressive enhancement also supplies save feedback, dirty-form protection, generation progress, and object-link insertion; server validation and revision checks remain authoritative.

The home page is a type overview with live-object counts; Trash uses the same overview with trashed counts. Neither overview lists mixed objects. A selected type has native List and Gallery layouts, with `layout=list` as the default and `layout=gallery` as the alternative. Links preserve the type, search, page, and trash filter; submitting a search resets pagination. Gallery excerpts are bounded plain text from SQLite's derived `body_text`, escaped by trusted rendering rather than rendered as user HTML. Browse layouts do not create views or change objects. Explicit cross-type search remains available; the native search page shows no records until a query is entered.

The object editor leads with its editable title, not a duplicate visible title heading. An always-visible Properties section follows the title and precedes writing. It contains the type selector for both new and existing objects, including types with no additional fields. Enhanced switching retains field drafts in the current page; native **Use type** submits `intent=change-type` to render fields without persisting an object or advancing its submitted revision. Inactive native drafts are carried separately from writable properties, including multi-valued references. Changing type never makes those inactive drafts authoritative saved values. Journal creation defaults its date and title without creating records on GET.

Rejected object writes retain raw fields, writing, creation request IDs, and submitted revisions. Duplicate-journal errors provide a link to the existing object without replacing the draft. Object save feedback has one location beside the save action; enhancement preserves server-rendered errors on initialization and updates that region on edits and submissions. Rejected type creation retains its name and Based on selection.

Enhanced search opens a native modal dialog with Ctrl/Command+K or the Search link. It preserves the current page and drafts, supports arrow/Tab navigation, and restores focus on Escape. **Insert object link** reuses that dialog, retaining the formatted-editor bookmark or native textarea selection. Choosing a result inserts one undoable formatted link, or escaped Markdown in source fallback, and marks the document dirty instead of navigating. Cancelling retains writing and selection. Both actions use `GET /objects/lookup?q=…`, which searches saved titles and writing across non-trashed objects. The response contains only IDs, titles, type names, and a truncation flag, with no-store caching and the existing request security boundary. Queries are literal, limited to 200 characters, and return at most 50 matches.

Object sections provide anchors to writing and backlinks. A revision conflict exposes the latest saved title, type, properties, rendered writing, and exact Markdown source alongside the draft. Native and enhanced forms require an explicit reconciled save against the displayed revision; enhancement leaves existing input values, formatted writing, and their stale revision untouched.

The desktop shell separates persistent left navigation, main content, and a collapsible/resizable right view assistant. Generated previews render in the main area. Smaller screens use AI and navigation drawers with keyboard focus containment and Escape dismissal. An active conversation and unsent prompt remain in browser tab storage across navigation and panel closing; successful turns remain in SQLite. Pinning and panel width are local browser preferences, not view definitions. Generation completion does not navigate away from unsaved object edits. Deleting a conversation’s latest view blocks further refinement with a clear error rather than silently choosing another target. New-view starter suggestions are strictly local, non-submitting composer fill/focus actions: they preserve any existing prompt, including whitespace, and are unavailable during refinement, active/saved threads, restoration, or generation.

Per-type browse pages contain 50 records in either layout, with bounded literal search. Object lookup and writing-link search contain at most 50 matches and report truncation; other pickers contain at most 200 candidates plus existing selections when needed. Markdown bodies are limited to 256 KiB of UTF-8. The service is loopback-only and single-owner: cookies isolate conversation histories, not shared objects or saved views. CSRF and origin/host checks are not a substitute for multi-user authentication.
