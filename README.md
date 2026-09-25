# Taskdesk

A local, object-first workspace. **Objects own data; views are ways to see it.** The built-in interface only browses and edits objects and types. New workspaces include a bundled demo; additional saved views are authored by AI, previewed as drafts, and explicitly published—there is no manual view builder.

## Run

Bun **1.4.2+** and a current browser:

```sh
bun install --frozen-lockfile
bun start
```

Open **http://127.0.0.1:3000/**. First initialization creates a descriptive demo using only the protected **Page, Task, Event, Reminder, and Journal** types, ordinary properties, linked Markdown, and trusted views. Start with **Page → Start here · your workspace is made of primitives**, or **Views → 01 · Start here**. The demo includes all nine property kinds, three published views, and a restorable example in Trash. It needs no model; creating types, editing objects, and opening saved views also work offline.

View generation uses your local Pi authentication and a real model. There is no deterministic fallback. If necessary, authenticate with Pi and select an available model:

```sh
PI_MODEL=openai-codex/gpt-5.5 bun start
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Loopback HTTP port |
| `DATABASE_PATH` | `.data/taskdesk.sqlite` | Authoritative SQLite database |
| `PI_MODEL` | Pi's model selection | Exact `provider/model-id` for generation |
| `PI_AUTH_PATH` | Pi's normal auth file | Optional authentication location |
| `PI_MODELS_PATH` | Pi's normal models file | Optional custom model definitions |

Bun loads `.env` files normally. Use one server per database. This is a local single-owner application, not an authenticated multi-user service.

## Use it

1. **Manage types:** use the built-in types directly, rename their display labels, or add your own fields. Under **Create a type**, choose **Based on** to reuse another type’s current properties—for example, create Work item based on Task. The new type shares property identities, not future field additions or built-in lifecycle rules. Built-in identities and core fields cannot be deleted.
2. **New content:** choose a type, enter a title and Markdown writing, then fill its properties under **Details**. Task has Done and an optional Due date. Event requires either All-day dates or Event time; Reminder requires either Reminder date or Reminder time, with no notifications. Range ends are exclusive. Page needs no extra properties. Type switching preserves title, writing, and field drafts; without JavaScript, choose **Use type** to load fields without saving. Only the selected type’s fields are saved on creation; existing objects also retain their existing properties.
3. **Views → Create view:** describe the view in the right-hand assistant, for example: “Show Task and Work item in an editable calendar using Due date. Include unscheduled objects.”
4. Review the generated draft in the main area, then publish. Continue the conversation to refine the latest result; **Refine with AI** explicitly starts a conversation about the selected view. Each refinement creates a separate draft.
5. Edit a bound date or board group through an explicitly editable published view. The command updates the original object. Deleting the view leaves the objects and other views intact.

**Journal** opens a daily date picker. **Open journal** reuses that day’s page or creates it once. A journal in Trash is offered for explicit restoration, never silently replaced. The journal date is independent of its title and creation timestamp; changing it cannot overwrite another day’s journal. Generic Journal creation also rejects duplicates while retaining the submitted draft. Today uses the browser’s local day with JavaScript and the server’s local day otherwise; an explicitly chosen date takes precedence.

Supported trusted components: list, table, calendar agenda, and board. A view can combine types through explicit stable-ID bindings. A calendar does not require a Task subclass or a common property label—only a compatible temporal property for each source. Events and Reminders have mutually exclusive all-day/timed fields: use separate calendar blocks for these representations and a nonempty filter on each bound field, without excluding genuinely undated tasks. Structural compatibility does not itself grant a write command.

**Objects** opens a type overview with totals for objects, types, and saved views—not a mixed feed. Choose a type there or in the sidebar to browse only its objects. Each type offers **List** and **Gallery** layouts; gallery cards show the title, a plain-text excerpt of saved writing, and the last-updated date. Layout controls work without JavaScript and preserve the current search, page, and trash scope. These are built-in browse layouts, not AI-authored saved views.

The sidebar also holds New content, Search, Calendar, Tasks, Journal, and pinned views. **Calendar** lists saved views containing a calendar; **Tasks** always browses the built-in Task type, even after renaming it. **Journal** opens a daily page; its object-type link browses all journal pages. **Manage types** edits schemas. Trash is also organized by type; Search remains available across types.

With JavaScript, **Search** or **Ctrl/Command+K** opens object search without leaving your current draft. Search titles and writing, use arrow keys or Tab to choose a result, and press Enter to open it. **Insert link** uses the same dialog, but selecting a result inserts an escaped Markdown link at the writing selection instead of navigating. Escape cancels without changing the draft or selection. Both actions search the full collection.

The **View assistant** opens on the right, resizes on desktop, and becomes a drawer on smaller screens. Closing it or navigating does not discard the current conversation or typed prompt. Navigation does not silently change its target. **Create view** and the assistant’s **New conversation** control start fresh. If generation finishes while an object has unsaved edits, it leaves those edits in place and offers a preview link instead of navigating away.

In a fresh, empty new-view conversation, optional starter suggestions fill and focus the composer locally. They never submit, call the provider, or overwrite an existing prompt—even whitespace. They stay hidden during refinement, in active/saved threads, and while restoring or generating. Review the prompt and explicitly choose **Generate view**; native forms remain the baseline without JavaScript.

Successful conversation turns are stored in SQLite and scoped to the browser visitor cookie. The active thread, unsent prompt, and panel visibility are remembered for the current browser tab; pins and panel width are local browser preferences. The assistant creates views, not arbitrary chat replies or object edits.

The model receives your prompt, up to 12 earlier prompts in the conversation, type/property metadata, and the prior declarative specification when refining. It does **not** receive object titles or writing unless you include them in a prompt. The configured provider processes that information. Generated HTML, JavaScript, SQL, and arbitrary code are not accepted.

See the [quick start](docs/quickstart.md) and [object/view contract](docs/object-contract.md) for detailed behavior and boundaries.

## Storage

SQLite stores canonical objects, Markdown bodies, shared property definitions, types, saved views, view conversations, revisions, and derived backlinks. The same plain Markdown textarea works with and without JavaScript. Source is stored as submitted, without a rich-text parse/serialize round trip. Bun renders saved writing; raw HTML remains text, unsafe link targets are not clickable, and images remain inert text placeholders.

Object pages link directly to **Edit Markdown**, **Read saved**, and **Linked from**. A conflicting save keeps your draft and shows the latest saved title, type, details, and writing for comparison. Reconcile the draft, then choose **Save reconciled changes**; a further concurrent edit still rejects the save. This works with and without JavaScript.

Save feedback stays beside the save button instead of appearing in duplicate page banners. With JavaScript, the same area shows the saved revision, unsaved changes, saving progress, or an error. Native forms show confirmation or errors there too, with a reminder that further edits still require saving.

The object workspace is the only supported application. Startup seeds the demo transactionally when first initializing an object database, or opens an existing workspace unchanged. It never reseeds an existing workspace, even after its objects are trashed or its views deleted. Demo dates are relative to the server's local initialization day and stay fixed afterward; timed examples use explicit UTC times. Startup does not import or migrate historical issue/vault data. Existing object data and visitor-owned view conversations remain usable. Unrelated tables and files are left untouched, not converted or deleted. Back up SQLite before upgrading; see the quick start.

Object schema version 3 adds protected built-in definitions and storage-enforced daily-journal dates. Version-2 databases upgrade transactionally without rewriting existing objects, revisions, creation receipts, custom labels, or user-created types—even types already named Task or Journal. Version-1 databases first convert supported structured writing to Markdown, preserving identities, links, history, and original creation receipts. Unknown schemas or incompatible reserved definitions abort the transaction. Back up SQLite before upgrading.

## Implementation

Bun supplies the HTTP server, SQLite driver, browser bundler, Markdown parser/renderer, HTML rewriting, file responses, cookie handling, hashing, and test runner. Hono supplies trusted JSX rendering, not routing. There is no rich-text editor runtime or editor-specific document format in new writes.

- `src/server.ts`, `src/visitors.ts`: secured local HTTP and persistent visitor identity/CSRF state.
- `src/objects/model.ts`: shared types and closed declarative view schema.
- `src/objects/workspace.ts`, `demo.ts`: atomic first-initialization demo using canonical object and view commands, with no model calls or separate sample store.
- `src/objects/runtime.ts`: canonical objects, property validation, revisions, commands, and backlinks.
- `src/objects/values.ts`: dependency-light scalar and temporal validation.
- `src/objects/markdown.ts`: bounded Markdown source, safe Bun rendering, search text, and link extraction.
- `src/objects/upgrade-markdown.ts`: transactional upgrade of existing structured object writing.
- `src/objects/views.ts`: persistent view lifecycle, prepared bounded queries, and scoped commands.
- `src/objects/conversations.ts`: visitor-owned view threads and atomic draft/turn persistence.
- `src/objects/generator.ts`: isolated metadata-only Pi generation and validated submission.
- `src/objects/http.ts`, `render.tsx`, `client.ts`: native forms, domain screens, trusted view components, and progressive enhancement.
- `src/objects/ui.tsx`: shared UI atoms and small page compositions.
- `public/tokens.css`, `public/objects.css`: design primitives/semantic roles and responsive component styling.

```sh
bun run check
bun test
```

## Design system

The UI follows **primitives → semantic roles → components**. `public/tokens.css` defines the warm paper/forest palette and shared typography, spacing, radius, and motion scales, then maps colors to roles such as `--surface-panel`, `--action-primary`, and `--border-control`. `public/objects.css` consumes those roles: control boundaries remain distinct from quiet decorative dividers. System sans-serif text uses a 15px body size at the default root size; Markdown writing uses the monospace role. Shared spacing, rounded surfaces, and short transitions keep the workspace cohesive.

`src/objects/ui.tsx` keeps the `Icon`, `Button`, `ButtonLink`, and `Badge` atoms together with the small `PageHeading` and `EmptyState` compositions. Domain screens stay in `src/objects/render.tsx`; fields and forms remain native HTML. This uses the existing Hono JSX renderer, with no additional component framework or dependencies. Buttons perform actions (`type="button"` by default); links navigate. A submit action must opt in explicitly:

```tsx
<>
  <Button type="submit" variant="primary">Save changes</Button>
  <ButtonLink href="/views">Back to views</ButtonLink>
</>
```

For CSS extensions, use semantic color roles and the existing primitive scales for spacing, typography, radii, and motion; do not add arbitrary palette constants per component. Preserve visible keyboard focus, disabled and pressed states, and reduced-motion behavior when extending a control.

## Current boundaries

No live type inheritance, generated plugins, arbitrary model execution, synchronization, attachment storage, notification delivery, or per-object sharing permissions. Custom types are flexible property recommendations; canonical built-ins additionally enforce their completion/date rules. Creating a type based on another type reuses its current property IDs, without copying objects or inheriting daily-journal uniqueness. Property kind, reference shape, and select options are fixed after creation; renaming labels is supported. Built-in core field attachments and identities are protected.

Browse pages show 50 objects. Generated blocks show up to 100 rows with an explicit truncation notice. Refine the prompt to narrow larger result sets. Object search and writing-link search return at most 50 matches and explicitly ask you to narrow truncated results. Other pickers are bounded to 200 candidates; existing selections remain visible. Calendar agendas group by the stored start date, not a month grid or recurrence engine.
