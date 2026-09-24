# Object workspace quick start

The historical filename is retained for existing documentation links. The current application is an object workspace, not an app-owned Today dashboard.

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
4. Open **New content**, choose Task, enter a title, and optionally add a date and writing. Choose **Create object** to save. Create another task without a date and a Meeting with a date. In the enhanced creation form, switching types keeps your title, writing, and property drafts in the open page; switching back restores the fields. Only the selected type’s properties are submitted. Without JavaScript, select **Use type** before entering your draft.
5. Insert an object link using the writing toolbar. Open the linked object to see its backlink.

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

## Forms and conflicts

The enhanced editor supports headings, emphasis, code, lists, undo/redo, and object mentions. Without JavaScript, native forms edit Markdown. Save is explicit. A failed enhanced submission retains the draft. Revision conflicts reject stale saves instead of overwriting a newer change; reload and reconcile the draft before retrying.

Native links and forms, CSRF protection, and the same server-side validation remain authoritative. Only published views that explicitly expose calendar-date or board-group editing have inline write controls.

## Back up and migrate

Use SQLite's backup operation for a running database:

```sh
sqlite3 .data/taskdesk.sqlite ".backup '/absolute/path/to/backup.sqlite'"
```

Alternatively stop the server and back up the database together with any `-wal`/`-shm` files. Do not copy only the main file while a writer is active.

Startup migrates existing legacy **SQLite** records transactionally. Original vault tables/files are retained, and the migration runs once. No app approval is required to see the owner's migrated objects. Legacy `/vault` mutations and app review are removed; legacy runtime/CLI access to migrated databases is rejected.

For a pre-SQLite directory, first prepare a new database with the legacy adapter, then open it in the current server:

```sh
bun run lifeapps import /absolute/path/to/legacy-directory --db /absolute/path/to/new-workspace.sqlite
DATABASE_PATH=/absolute/path/to/new-workspace.sqlite bun start
```

Do not run the legacy export tool on a migrated workspace: its archived records are no longer the current objects. Back up the SQLite database instead. Editing old Markdown files or changing `VAULT_ROOT` does not change live objects.

See the [object/view contract](app-definition-v1.md) for storage, query, and command constraints.
