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
2. **New content:** choose a type, enter a title, and add optional details and rich writing. Switching types in the enhanced creation form preserves title, writing, and property drafts for switching back; only the selected type’s properties are saved. Choose **Create object** to save. Page works without custom properties. Object links produce backlinks; trash is reversible.
3. **Views → Create view:** describe the view in the right-hand assistant, for example: “Show Task and Meeting in an editable calendar using their date property. Include unscheduled objects.”
4. Review the generated draft in the main area, then publish. Continue the conversation to refine the latest result; **Refine with AI** explicitly starts a conversation about the selected view. Each refinement creates a separate draft.
5. Edit a bound date or board group through an explicitly editable published view. The command updates the original object. Deleting the view leaves the objects and other views intact.

Supported trusted components: list, table, calendar agenda, and board. A view can combine types through explicit stable-ID bindings. A calendar does not require a Task subclass or a common property label—only a compatible temporal property for each source. Structural compatibility does not itself grant a write command.

The left sidebar holds New content, Search, Calendar, Tasks, pinned views, and your object types. **Calendar** lists saved views containing a calendar; **Tasks** browses an existing type named Task or Tasks without creating one automatically. Object-type links browse that type; **Manage types** edits its schema.

The **View assistant** opens on the right, resizes on desktop, and becomes a drawer on smaller screens. Closing it or navigating does not discard the current conversation or typed prompt. Navigation does not silently change its target. **Create view** and the assistant’s **New conversation** control start fresh. If generation finishes while an object has unsaved edits, it leaves those edits in place and offers a preview link instead of navigating away.

Successful conversation turns are stored in SQLite and scoped to the browser visitor cookie. The active thread, unsent prompt, and panel visibility are remembered for the current browser tab; pins and panel width are local browser preferences. The assistant creates views, not arbitrary chat replies or object edits.

The model receives your prompt, up to 12 earlier prompts in the conversation, type/property metadata, and the prior declarative specification when refining. It does **not** receive object titles or writing unless you include them in a prompt. The configured provider processes that information. Generated HTML, JavaScript, SQL, and arbitrary code are not accepted.

See the [quick start](docs/vault-quickstart.md) and [object/view contract](docs/app-definition-v1.md) for detailed behavior and boundaries.

## Storage and migration

SQLite stores canonical objects, structured documents, shared property definitions, types, saved views, view conversations, revisions, and derived backlinks. ProseMirror edits structured writing; server-rendered forms also work without JavaScript through a Markdown fallback. Images remain text placeholders and are not fetched.

Existing SQLite vault records migrate transactionally on first object-runtime startup, regardless of legacy app grants. IDs, source tables, and original files are retained. Unknown structured metadata is stored reversibly with an encoding map. Invalid or unsupported data aborts initialization rather than being silently dropped. Back up before upgrading; see the quick start.

The old Today/app-approval HTTP surface is retired. Legacy CLI commands refuse migrated object databases, preventing a second writable authority. The `lifeapps` parser/import tools remain for preparing legacy data **before** migration, not editing current objects. No directory is watched or treated as live storage; `VAULT_ROOT` no longer bootstraps the server.

The original issue-conversation experiment remains separately at `/issues/new`. Its demo mode, Pi chat, and `bun run smoke:pi` belong to that experiment, not the object workspace or its view generator.

## Implementation

- `src/objects/model.ts`: shared types and closed declarative view schema.
- `src/objects/runtime.ts`: canonical objects, property validation, revisions, commands, and backlinks.
- `src/objects/migration.ts`: transactional legacy SQL migration.
- `src/objects/document.ts`: bounded structured documents and safe rich links.
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
