# Taskdesk

A local, object-first workspace. **Objects own data; views are ways to see it.** The built-in interface only browses and edits objects and types. Saved views are authored by AI, previewed as drafts, and explicitly published—there is no manual view builder.

## Run

Bun **1.4.2+** and a current browser:

```sh
bun install --frozen-lockfile
bun start
```

Open **http://127.0.0.1:3000/**. A fresh database contains only the Page type, with no example objects or views. Creating types, editing objects, and opening saved views do not require a model.

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

1. **Manage types:** create Task and Meeting. Give Task a Date property, then attach that same property to Meeting with **Use an existing property**. Type cards show their fields; setup explains each property format and identifies shared labels before renaming.
2. **New content:** choose a type, enter a title, and add optional details and Markdown writing. Edit the source directly; saved writing has a rendered reading view. Switching types in the enhanced creation form preserves title, writing, and property drafts for switching back; only the selected type’s properties are saved. Choose **Create object** to save. Page works without custom properties. Standard `[label](/objects/UUID)` links produce backlinks; trash is reversible.
3. **Views → Create view:** describe the view in the right-hand assistant, for example: “Show Task and Meeting in an editable calendar using their date property. Include unscheduled objects.”
4. Review the generated draft in the main area, then publish. Continue the conversation to refine the latest result; **Refine with AI** explicitly starts a conversation about the selected view. Each refinement creates a separate draft.
5. Edit a bound date or board group through an explicitly editable published view. The command updates the original object. Deleting the view leaves the objects and other views intact.

Supported trusted components: list, table, calendar agenda, and board. A view can combine types through explicit stable-ID bindings. A calendar does not require a Task subclass or a common property label—only a compatible temporal property for each source. Structural compatibility does not itself grant a write command.

The left sidebar holds New content, Search, Calendar, Tasks, pinned views, and your object types. **Calendar** lists saved views containing a calendar; **Tasks** browses an existing type named Task or Tasks without creating one automatically. Object-type links browse that type; **Manage types** edits its schema.

The **View assistant** opens on the right, resizes on desktop, and becomes a drawer on smaller screens. Closing it or navigating does not discard the current conversation or typed prompt. Navigation does not silently change its target. **Create view** and the assistant’s **New conversation** control start fresh. If generation finishes while an object has unsaved edits, it leaves those edits in place and offers a preview link instead of navigating away.

Successful conversation turns are stored in SQLite and scoped to the browser visitor cookie. The active thread, unsent prompt, and panel visibility are remembered for the current browser tab; pins and panel width are local browser preferences. The assistant creates views, not arbitrary chat replies or object edits.

The model receives your prompt, up to 12 earlier prompts in the conversation, type/property metadata, and the prior declarative specification when refining. It does **not** receive object titles or writing unless you include them in a prompt. The configured provider processes that information. Generated HTML, JavaScript, SQL, and arbitrary code are not accepted.

See the [quick start](docs/quickstart.md) and [object/view contract](docs/object-contract.md) for detailed behavior and boundaries.

## Storage

SQLite stores canonical objects, Markdown bodies, shared property definitions, types, saved views, view conversations, revisions, and derived backlinks. The same plain Markdown textarea works with and without JavaScript. Source is stored as submitted, without a rich-text parse/serialize round trip. Bun renders saved writing; raw HTML remains text, unsafe link targets are not clickable, and images remain inert text placeholders.

The object workspace is the only supported application. Startup initializes a fresh object database or opens an existing one; it does not import or migrate historical issue/vault data. Existing object data and visitor-owned view conversations remain usable. Unrelated tables and files are left untouched, not converted or deleted. Back up SQLite before upgrading; see the quick start.

Object schema version 2 stores writing as Markdown. Existing version-1 object databases upgrade transactionally on startup, converting structured writing and revision snapshots while preserving object IDs, revisions, references, and creation receipts. Unknown or unsupported data aborts the upgrade rather than dropping writing. Back up before the first start after upgrading. This is a change to the current object format, not a return of the removed vault import system.

## Implementation

Bun supplies the HTTP server, SQLite driver, browser bundler, Markdown parser/renderer, HTML rewriting, file responses, cookie handling, hashing, and test runner. Hono supplies trusted JSX rendering, not routing. There is no rich-text editor runtime or editor-specific document format in new writes.

- `src/server.ts`, `src/visitors.ts`: secured local HTTP and persistent visitor identity/CSRF state.
- `src/objects/model.ts`: shared types and closed declarative view schema.
- `src/objects/runtime.ts`: canonical objects, property validation, revisions, commands, and backlinks.
- `src/objects/values.ts`: dependency-light scalar and temporal validation.
- `src/objects/markdown.ts`: bounded Markdown source, safe Bun rendering, search text, and link extraction.
- `src/objects/upgrade-markdown.ts`: transactional upgrade of existing structured object writing.
- `src/objects/views.ts`: persistent view lifecycle, prepared bounded queries, and scoped commands.
- `src/objects/conversations.ts`: visitor-owned view threads and atomic draft/turn persistence.
- `src/objects/generator.ts`: isolated metadata-only Pi generation and validated submission.
- `src/objects/http.ts`, `render.tsx`, `client.ts`: minimal native forms, trusted components, and progressive enhancement.
- `public/objects.css`: responsive workspace styling.

```sh
bun run check
bun test
```

## Current boundaries

No type inheritance, generated plugins, arbitrary model execution, synchronization, attachment storage, or per-object sharing permissions. Types are defaults rather than rigid record schemas; the editor exposes type properties and properties already present on an object. Property kind, reference shape, and select options are fixed after creation; renaming labels is supported.

Browse pages show 50 objects. Generated blocks show up to 100 rows with an explicit truncation notice. Refine the prompt to narrow larger result sets. Pickers are bounded to 200 candidates; existing selections remain visible. Calendar agendas group by the stored start date, not a month grid or recurrence engine.
