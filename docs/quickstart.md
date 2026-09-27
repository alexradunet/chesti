# Object workspace quick start

Create objects, share properties between types, and use AI to author views over the same data.

## Start

```sh
bun install --frozen-lockfile
bun start
```

Open **http://127.0.0.1:3000/**. A new object workspace starts with an editable demo built from Page, Task, Event, Reminder, and Journal, ordinary properties, linked Markdown, and published views. To initialize another workspace, choose a new database path; an existing workspace is never reseeded. To use another database or an explicit authenticated model:

```sh
DATABASE_PATH=/absolute/path/to/workspace.sqlite \
PI_MODEL=openai-codex/gpt-5.5 bun start
```

Model availability depends on your Pi credentials. Object editing and saved views work without model access; generating or refining a view does not. Generation failures leave existing views and objects unchanged.

## Explore the demo

The fictional neighborhood reading-room project demonstrates the application without plugins, generated code, or a provider call. All examples are ordinary saved objects, not a separate tutorial mode.

1. Open **Page → Start here · your workspace is made of primitives**. Its writing is directly formatted and editable with JavaScript; native fallback provides **Read saved writing** below the source. Follow the guide links to the project brief, writing guide, view guide, and safe-experiment guide. Page's List and Gallery layouts browse the same content.
2. Open **Views → 01 · Start here**. Read the guide-page list, change a task's Done value on the board, and see that same task in the table. Its source is labeled `built-in/demo`, not an AI provider.
3. Open **Calendar → 02 · Calendar**. Task due dates and Journal dates share an agenda. Events and Reminders have separate all-day/timed blocks; undated tasks remain Unscheduled. Use an inline date action to reschedule the original object.
4. Open **Views → 03 · Page focus** and select **Reading room · a small neighborhood project**. Its shared Context reference scopes unfinished tasks and related events, reminders, and journals. Select the Writing page to see a different task; no input means no results.
5. Open **Trash → Task → Restore me · a discarded checklist** to try restoration. Edit or trash any example normally. Deleting a demo view never deletes its objects.

The demo includes all nine property kinds, single and multiple references, writing backlinks, a completed task, an undated task, and one daily journal. Dates are relative to the server's local initialization day; timed examples use UTC. They are saved once, not moved forward on restart.

Initialization and all demo writes commit together or roll back together. Existing databases—including empty workspaces—keep their data and customizations. Restarting does not overwrite edits, restore trashed examples, or recreate deleted views. To see the pristine demo again without losing your workspace, start with a different `DATABASE_PATH`. Back up before intentionally replacing any database.

The bundled views are already published so you can try their actions offline. Creating or refining additional views still requires Pi authentication and explicit draft publication; the demo is not a fallback for generation failures.

## Create shared data

1. Open **Manage types** in the left sidebar. Task already has **Done**, **Due date**, and **Scheduled date**. Built-in types and their core fields are protected, but you can rename display labels and add fields.
2. Under **Create a type**, enter `Work item`, choose Task under **Based on**, and choose **Create type & add properties**. This reuses the current Done and Due date property identities. The new type is independent: later field additions and built-in lifecycle rules do not propagate.
3. Add an `Effort` property with the **Number** format to Work item. Use **Use an existing property** when the same concept is already represented elsewhere. Property cards show formats and choices; **Rename property** identifies other types that share its label.
4. Open **New note** for a generic Page, or open **Objects** and choose a type-specific new object. For a Task, add Scheduled date and/or Due date in **Properties**, above the optional writing. Choose **Create object** to save. Create another task without a date and a Work item with a date. Switching types keeps title, writing, and field drafts; without JavaScript, choose **Use type** to load the selected fields without saving. Only the selected type’s properties are saved on creation; existing objects also retain their existing fields.
5. Choose **Insert object link** above writing, search, and choose an object. Markdown source also accepts a normal link such as `[Project](/objects/UUID)`. Open the linked object to see its backlink.

Types and properties can be renamed. Existing objects keep their identity and properties when changing type; references targeting the old type must be resolved before an incompatible type change. Trash retains data and can be restored. Existing references survive trash, but new references to trashed objects are rejected.

## Use the built-ins

- **Page:** a generic text page with no required extra properties.
- **Task:** an action with Done, an optional Scheduled date, and an optional Due date. Unchecked means incomplete.
- **Event:** fill either All-day dates or Event time, not both. Ends are exclusive: a one-day event on September 24 runs from September 24 to September 25. Timed ranges require explicit timestamp offsets and an IANA time zone such as `Europe/London` or `UTC`.
- **Reminder:** fill either Reminder date or Reminder time. It is only a calendar item; it does not send an alert, snooze, repeat, or track completion.
- **Journal:** one canonical writing page per calendar day.

Use **Calendar** for daily journaling in the day workspace, or open `/journal` directly for the standalone journal picker. Opening an existing day preserves its writing; opening a new day from `/journal` creates one empty page titled with its date. The Calendar day workspace creates an empty day's journal only after you write and save. A chosen date always takes precedence.

Rename a journal freely without changing its day. Change Journal date only to an unoccupied day. A journal in Trash still owns its date: open the existing page and choose **Restore object**, rather than creating a replacement. Duplicate creation keeps your unsaved draft and links to the existing page; no writing is automatically merged or discarded.

Add fields such as Mood to Journal or Priority to Task to customize the built-ins. A custom type based on Journal shares its date property but is not another canonical daily journal; it can have multiple objects per date.

## Browse, favorite, and use the day workspace

The home page, **Objects**, shows totals for objects, types, and saved views, followed by types and their object counts—not a mixed object feed. Choose a type card to see only objects of that type. **New object** on that page starts an object with the chosen type. **New note** in the sidebar starts a generic Page.

Favorite a saved object from its object page to show it in the sidebar Favorites list. Favorites are shared workspace metadata in SQLite; they survive restart and renames, do not change object revisions, and are hidden while the object is in Trash. Use **All favorites** when there are more than 50.

**Calendar** opens today's server-local day workspace by default. Pick another date with the previous/next/today links or the month date picker. The day shows an explicitly saved Journal, canonical Task objects whose Scheduled date or Due date matches the selected date, and live objects created during that local day. Tasks matching both dates appear once with both labels; completed tasks remain visible. Empty day journals are created only when you write and save.

Use **List** for compact rows or **Gallery** for cards with titles, saved-writing excerpts, and update dates. List is the default; the selected layout is part of the page URL, so refreshing or using browser Back retains it. Switching layouts keeps your search and page. Both layouts work without JavaScript and do not create or modify a saved view.

Search on a type page stays within that type. Each page shows up to 50 objects; use Next and Previous for more. **Trash** first shows types, and a type page's trash link stays scoped to that type. Use the sidebar's **Search** when you want to search across types.

## Generate views, do not configure them manually

Open **Views → Create view**. In the right-hand View assistant, ask:

> Create an editable calendar showing all Task and Work item objects using Due date. Keep undated objects visible as unscheduled.

With JavaScript, a fresh new-view conversation offers starter suggestions when the composer is completely empty. Choosing one only fills and focuses the composer locally; it never submits or calls the provider. Suggestions never replace an existing prompt, including whitespace, and are hidden for refinement, active/saved threads, and while restoring or generating. Edit the prompt as needed, then explicitly choose **Generate view**. Without JavaScript, enter the prompt and submit the native form.

The model sees your prompt, schema metadata, up to 12 prior conversation prompts, and the previous view specification when refining—not object titles or writing unless you put them in your prompt. Review the draft in the main area and choose **Publish view**. Open **Edit Due date** on a row to reschedule the original object. Rename Due date to Deadline in Manage types: the saved view still works because bindings use property IDs.

Continue in the assistant to refine its latest result, or use **Refine with AI** to explicitly start a thread about the view you are looking at. For example:

> Keep the calendar and add an editable Task board grouped by Done, plus a table showing the scheduled dates.

Refinement creates another draft. Neither generation nor publication changes objects. Deleting either view leaves the shared data and the other view intact.

A reference-based view can ask for an input object, such as a Project. Without selecting that input it shows no records; it does not fall back to an unfiltered collection.

For a combined life calendar, ask for Task due dates, Journal dates, both Event formats, and both Reminder formats. Events and Reminders use separate calendar blocks for their all-day and timed alternatives, with nonempty filters on the corresponding fields. This does not duplicate objects. Reschedule within the same date format in an editable calendar; switch between all-day and timed formats in the object editor by clearing one field and filling the other.

## Navigate without losing the conversation

The left sidebar stays available while the assistant is open on desktop. **Calendar** opens the day workspace; saved calendar views remain under **Views**. Objects opens type browsing, Search opens cross-type search, Manage types edits schemas, and Trash shows recoverable objects. Use **Pin view** to add a saved view to your sidebar.

Close/reopen the assistant or navigate to another object: the active conversation and unsent prompt stay in the current browser tab. The **Working on** chip identifies the refinement target; browsing does not change it. **Create view** or **New conversation** starts fresh. Successful turns survive server restarts in SQLite; the active-thread pointer lives in browser tab storage.

Drag the panel divider or use its arrow keys to resize on desktop. On smaller screens, AI opens as a drawer; on mobile, navigation does too. Escape closes the open panel. If AI finishes while your editor has unsaved changes, save those changes before following its preview link.

## Find and link objects

Choose **Search**, or press **Ctrl+K** (**Command+K** on Mac), to search without leaving your current object or AI draft. Enter a title or a phrase from saved writing, then press Enter. Use Down/Up or Tab to choose a result and Enter to open it. Escape closes search and returns focus. Opening another object still warns about unsaved object edits. Without JavaScript, Search opens a native search form; enter a query to see cross-type results.

To insert a link, place the cursor or select text in your writing, then choose **Insert object link**. The object-search dialog opens with the heading **Insert an object link**. Search a title or phrase, press Enter, then choose a result with the mouse or arrow keys and Enter. The result replaces only the selection with a link and returns focus to writing; it does not navigate or save. Formatted insertion is undoable, and the source fallback inserts escaped Markdown. Escape cancels without changing the writing or selection. Searches cover every live object and return up to 50 matches; narrow the query if more exist.

With JavaScript, reference fields and view input forms include **Find object** beside the native select. It opens the same search dialog scoped to the required target type, so older objects outside the first 200 native options can still be selected. Choosing a result only updates that select and marks the form dirty when applicable; it does not save an object, run a view action, show a view, navigate, publish, or generate. Multiple-reference fields add the result without clearing current selections; use the native select to remove links. Without JavaScript, keep using the bounded native select and submit normally.

Use **Writing**, **Linked from**, and **History** to move around an object. Linked from shows incoming property and writing links in pages of 50 so large workspaces stay responsive without hiding the remaining links. History lists saved snapshots without changing the object. Select a revision to read its rendered writing and exact Markdown source, then choose **Open unsaved draft** only when the historical fields can be safely represented in the current editor and you want to copy that snapshot into the editor for this same object. The draft still saves through the normal revision check and current validation; it is not a force restore, it does not restore Trash, and it can conflict if the object changed. The formatted editor is the primary writing surface. The native fallback's saved reader shows the last saved version, never a live draft preview.

## Forms and conflicts

With JavaScript, edit headings, emphasis, lists, task checkboxes, tables, quotes, code, and links directly in formatted writing. The native toolbar offers paragraph styles, formatting, links, undo, and redo; Tab leaves text editing for other controls, and Ctrl/Command+K remains workspace search. Save is explicit. The **Link** dialog applies on Enter; clearing its address removes the link. Cancelling does not change the document. Markdown remains the stored format: actual writing edits may normalize its syntax and whitespace. Loading, changing only title/properties, and undoing back to the initial document preserve the original source exactly. If formatted edits cannot round-trip through the submitted Markdown without changing their content, Save explains the problem and leaves the live draft editable instead of submitting a lossy version.

Without JavaScript, while the editor loads, or if source cannot round-trip safely, edit the Markdown textarea and save normally. A visible explanation accompanies unavailable formatted editing or unsupported imports; the original source is not replaced. Native browser submissions can normalize line endings. Pasted text is parsed as Markdown when safe; unsupported pasted constructs stay literal with an explanation. Clipboard HTML and external files are not imported. Raw HTML stays inert, unsafe links are not clickable, and remote images are not loaded.

The editable title comes first, followed by the always-visible **Properties** panel, then writing. Both new and existing objects have their type selector inside Properties, even when the type has no additional fields. Save feedback appears in one place beside the save button: the enhanced editor distinguishes saved, unsaved, saving, and rejected states. Native forms show save confirmation or errors in the same place, but cannot detect edits as you type.

If another save has changed the object, your draft stays in the editor. **Compare before saving** shows the latest saved title, type, properties, rendered writing, and copyable Markdown source beside it (below it on small screens). Reconcile all fields you want to retain, then choose **Save reconciled changes**. This explicitly replaces the displayed saved revision; it does not merge automatically. If the object changes again, saving is rejected and the comparison refreshes without discarding the draft. **Back to your draft** returns to the writing field. The same review-and-save flow works without JavaScript.

When adding a type property, rejected native submissions keep the label, format, choices, reference target, multiplicity, and the originally submitted revision in the form so you can correct the error. A stale type revision is not advanced automatically; before reloading, copy the retained draft or review the latest type setup in another tab, because reload discards the draft. Then resubmit the property you still want to add against the latest fields.

Native links and forms, CSRF protection, and the same server-side validation remain authoritative. Only published views that explicitly expose calendar-date or board-group editing have inline write controls.

## Back up

Use SQLite's backup operation for a running database:

```sh
sqlite3 .data/taskdesk.sqlite ".backup '/absolute/path/to/backup.sqlite'"
```

To verify and trial-restore a backup, copy from an existing backup into a new private temporary directory—never overwrite the live database or an existing restore target—and start Taskdesk on that same restored file only after every command and check passes. `-readonly` makes a missing backup fail instead of creating an empty database; `integrity_check` must return exactly `ok`, and `foreign_key_check` must return no rows. Keep the restored database private to this check and replace `/absolute/path/to/backup.sqlite` with the backup you intend to test; if copying or verification fails, the shell block stops before launch.

```sh
(
  set -eu
  backup=/absolute/path/to/backup.sqlite
  tmpdir=$(mktemp -d -t taskdesk-restore-check-XXXXXX)
  restored="$tmpdir/restored.sqlite"
  test -f "$backup"
  test ! -e "$restored"
  sqlite3 -readonly "$backup" ".backup '$restored'"
  integrity=$(sqlite3 -readonly "$restored" "PRAGMA integrity_check;")
  test "$integrity" = ok
  foreign_keys=$(sqlite3 -readonly "$restored" "PRAGMA foreign_key_check;")
  test -z "$foreign_keys"
  DATABASE_PATH="$restored" bun start
)
```

For a compact non-incremental snapshot from SQLite itself, `VACUUM INTO '/absolute/path/to/snapshot.sqlite'` writes a new database file. Use a new destination filename; treat interruption or errors as a failed snapshot and keep the original database untouched. `VACUUM INTO` is a snapshot operation, not backup rotation or a continuous export system.

Alternatively stop the server and back up the database together with any `-wal`/`-shm` files. Do not copy only the main file while a writer is active, and do not casually copy a live WAL sidecar beside a separately copied main file. These instructions cover the current single SQLite database only; they do not claim cross-file atomic backups for future workspace files.

Synthetic storage measurements are documented in [SQLite storage measurements](sqlite-measurements.md).

Back up before upgrading to object schema version 5. Startup transactionally centralizes the current application schema and adds conservative structural checks for object JSON, property metadata, revisions, and saved-view history without changing existing objects, views, conversations, visitor identities, labels, revisions, creation receipts, or unrelated tables. Existing version-3 databases are preserved; version-2 databases first add built-in types, core fields, and journal date constraints; version-1 structured writing and history first convert to Markdown in the same transaction, preserving identities and links. Incompatible reserved definitions or existing rows that violate the new structural checks abort rather than overwrite data.

Empty editor paragraphs retain blank-line source, and ending or consecutive hard breaks become ordinary Markdown whitespace breaks. Markdown may collapse empty editor blocks visually; it does not add placeholders or raw HTML. Emphasis is preserved across punctuation, whitespace, and adjacent or nested marks; conversion may use character entities to prevent Markdown delimiter ambiguity. These conversions also apply to historical revisions and creation receipts, and the converted Markdown must fit the 256 KiB writing limit. Unknown or malformed structures and unsupported content such as inline code containing newlines still abort the upgrade. On failure, the transaction leaves the version-1 database intact and usable by the previous application version; the reported conversion issue must be resolved before upgrading.

Only the current object database is supported. There is no historical issue/vault runtime, directory import/export tool, or legacy migration path. Startup never converts or deletes unrelated tables or files. Back up the SQLite database rather than treating Markdown files as live storage.

See the [object/view contract](object-contract.md) for storage, query, and command constraints.
