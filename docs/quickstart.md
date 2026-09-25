# Object workspace quick start

Create objects, share properties between types, and use AI to author views over the same data.

## Start

```sh
bun install --frozen-lockfile
bun start
```

Open **http://127.0.0.1:3000/**. A new database contains Page and no seeded objects. To use another database or an explicit authenticated model:

```sh
DATABASE_PATH=/absolute/path/to/workspace.sqlite \
PI_MODEL=openai-codex/gpt-5.5 bun start
```

Model availability depends on your Pi credentials. Object editing and saved views work without model access; generating or refining a view does not. Generation failures leave existing views and objects unchanged.

## Create shared data

1. Open **Manage types** in the left sidebar. Under **Create a type**, enter `Task` and choose **Create type & add properties**.
2. Add a property named `Due` with the **Date** format. Optionally add `Done` with the **Checkbox** format. Format descriptions explain what each field stores; Select and Object link reveal their required settings.
3. Create `Meeting`. Attach `Due` using **Use an existing property**. This shares its identity, not merely its label. Property cards show their format and choices; **Rename property** identifies other types that share the label.
4. Open **New content**, choose Task, enter a title and optional writing, then add a date under **Details**. Choose **Create object** to save. Create another task without a date and a Meeting with a date. In the enhanced creation form, switching types keeps your title, writing, and property drafts in the open page; switching back restores the fields. Only the selected type’s properties are submitted. Without JavaScript, select **Use type** before entering your draft.
5. Write a normal Markdown link such as `[Project](/objects/UUID)`, or select **Insert link** above the writing field, search, and choose an object. Open the linked object to see its backlink.

Types and properties can be renamed. Existing objects keep their identity and properties when changing type; references targeting the old type must be resolved before an incompatible type change. Trash retains data and can be restored. Existing references survive trash, but new references to trashed objects are rejected.

## Generate views, do not configure them manually

Open **Views → Create view**. In the right-hand View assistant, ask:

> Create an editable calendar showing all Task and Meeting objects using Due. Keep undated objects visible as unscheduled.

The model sees your prompt, schema metadata, up to 12 prior conversation prompts, and the previous view specification when refining—not object titles or writing unless you put them in your prompt. Review the draft in the main area and choose **Publish view**. Open **Edit Due** on a row to reschedule the original object. Rename Due to Scheduled in Manage types: the saved view still works because bindings use property IDs.

Continue in the assistant to refine its latest result, or use **Refine with AI** to explicitly start a thread about the view you are looking at. For example:

> Keep the calendar and add an editable Task board grouped by Done, plus a table showing the scheduled dates.

Refinement creates another draft. Neither generation nor publication changes objects. Deleting either view leaves the shared data and the other view intact.

A reference-based view can ask for an input object, such as a Project. Without selecting that input it shows no records; it does not fall back to an unfiltered collection.

## Navigate without losing the conversation

The left sidebar stays available while the assistant is open on desktop. **Calendar** lists calendar-containing saved views; **Tasks** shows objects from an existing Task or Tasks type. Object-type links browse that type. Use **Pin view** to add a saved view to your sidebar.

Close/reopen the assistant or navigate to another object: the active conversation and unsent prompt stay in the current browser tab. The **Working on** chip identifies the refinement target; browsing does not change it. **Create view** or **New conversation** starts fresh. Successful turns survive server restarts in SQLite; the active-thread pointer lives in browser tab storage.

Drag the panel divider or use its arrow keys to resize on desktop. On smaller screens, AI opens as a drawer; on mobile, navigation does too. Escape closes the open panel. If AI finishes while your editor has unsaved changes, save those changes before following its preview link.

## Find and link objects

Choose **Search**, or press **Ctrl+K** (**Command+K** on Mac), to search without leaving your current object or AI draft. Enter a title or a phrase from saved writing, then press Enter. Use Down/Up or Tab to choose a result and Enter to open it. Escape closes search and returns focus. Opening another object still warns about unsaved object edits. Without JavaScript, Search opens the ordinary browse form.

To insert a link, place the cursor or select text in your writing, then choose **Insert link**. The same object-search dialog opens with the heading **Insert an object link**. Search a title or phrase, press Enter, then choose a result with the mouse or arrow keys and Enter. The result replaces only the selected text with a Markdown link and returns focus to the writing; it does not navigate or save. Escape cancels without changing the writing or selection. Searches cover every live object and return up to 50 matches; narrow the query if more exist.

Use **Edit Markdown**, **Read saved**, and **Linked from** to move around an object. The saved reader is never a live preview of the draft.

## Forms and conflicts

Writing is Markdown-first: edit plain source for headings, emphasis, code, lists, and links. The same textarea works without JavaScript. Save is explicit; **Read saved writing** renders the last saved content, not an unsaved live preview. Raw HTML is displayed as text, unsafe links are not clickable, and remote images are not loaded.

Title and writing come first. **Details** follows the writing and starts closed when there are no custom fields. For an existing object, its type selector is inside Details. Save feedback appears in one place beside the save button: the enhanced editor distinguishes saved, unsaved, saving, and rejected states. Native forms show save confirmation or errors in the same place, but cannot detect edits as you type.

If another save has changed the object, your draft stays in the editor. **Compare before saving** shows the latest saved title, type, properties, rendered writing, and copyable Markdown source beside it (below it on small screens). Reconcile all fields you want to retain, then choose **Save reconciled changes**. This explicitly replaces the displayed saved revision; it does not merge automatically. If the object changes again, saving is rejected and the comparison refreshes without discarding the draft. **Back to your draft** returns to the writing field. The same review-and-save flow works without JavaScript.

Native links and forms, CSRF protection, and the same server-side validation remain authoritative. Only published views that explicitly expose calendar-date or board-group editing have inline write controls.

## Back up

Use SQLite's backup operation for a running database:

```sh
sqlite3 .data/taskdesk.sqlite ".backup '/absolute/path/to/backup.sqlite'"
```

Alternatively stop the server and back up the database together with any `-wal`/`-shm` files. Do not copy only the main file while a writer is active.

Back up before moving from object schema version 1 to 2. Startup converts existing structured writing and revision snapshots to Markdown in one transaction, preserving object identities and links. Unsupported structures abort the upgrade without partial changes. New writing is stored as Markdown source, not editor JSON; writing backlinks point to the source object rather than an editor block.

Empty editor paragraphs retain blank-line source, and ending or consecutive hard breaks become ordinary Markdown whitespace breaks. Markdown may collapse empty editor blocks visually; it does not add placeholders or raw HTML. These conversions also apply to historical revisions and creation receipts. Unknown or malformed structures and unsupported content such as inline code containing newlines still abort the upgrade. On failure, the transaction leaves the version-1 database intact and usable by the previous application version; the reported conversion issue must be resolved before upgrading.

Only the current object database is supported. There is no historical issue/vault runtime, directory import/export tool, or legacy migration path. Startup never converts or deletes unrelated tables or files. Back up the SQLite database rather than treating Markdown files as live storage.

See the [object/view contract](object-contract.md) for storage, query, and command constraints.
