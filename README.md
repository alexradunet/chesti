# Taskdesk

A local, object-first workspace. **Objects own data; views are ways to see it.** Taskdesk now starts from a fresh version-7 database with six fixed domains: Page, Task, Event, Reminder, Daily Page, and Person. The home dashboard is the calendar day workspace with today's Daily Page. New workspaces include a bundled demo; additional saved views are authored by AI, previewed as drafts, and explicitly published—there is no manual view builder or schema editor.

## Run

Bun **1.4.2+** and a current browser:

```sh
bun install --frozen-lockfile
bun start
```

To inspect the SQLite engine embedded in the exact Bun executable you are using, run:

```sh
bun run sqlite:runtime
```

This opens only an in-memory database and reports Bun's SQLite version, source ID, compile options, and direct feature probes. See [the SQLite runtime evaluation](docs/sqlite-runtime.md) for the current patch-level decision; the supported minimum remains Bun 1.4.2 until a newer stable Bun runtime is verified.

Open **http://127.0.0.1:3000/**. First initialization creates a descriptive demo using only the fixed **Page, Task, Event, Reminder, Daily Page, and Person** domains, Markdown links, and trusted views. It needs no model; editing objects and opening saved views work offline. Existing v1–v6 object databases are refused rather than migrated—choose a new `DATABASE_PATH` for this fresh fixed-domain format.

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

1. **Choose a domain:** create one of the six fixed domains. Page has only title and Markdown. Task has Done, Scheduled, and Due. Event and Reminder use their fixed temporal fields. Daily Page has one date. Person has relationship details and derived reconnect dates.
2. **New note** creates a generic Page. For other new objects, enter a title, choose a type and fill its always-visible compact property rows, then edit Markdown writing below. New-object fields use two columns when space allows; the formatting toolbar scrolls horizontally rather than pushing writing farther down. Small screens and types with many fields can still require vertical scrolling. Task has Done, an optional Scheduled date, and an optional Due date. Event requires either All-day dates or Event time; Reminder requires either Reminder date or Reminder time, with no notifications. Range ends are exclusive. Page needs no extra properties. Type switching preserves title, writing, and field drafts; without JavaScript, choose **Use type** to load fields without saving. Only the selected type’s fields are saved on creation; existing objects also retain their existing properties.
3. **Views → Create view:** describe the view in the right-hand assistant, for example: “Show Task and Work item in an editable calendar using Due date. Include unscheduled objects.”
4. Review the generated draft in the main area, then publish. Continue the conversation to refine the latest result; **Refine with AI** explicitly starts a conversation about the selected view. Each refinement creates a separate draft.
5. Edit a bound date or board group through an explicitly editable published view. The command updates the original object. Deleting the view leaves the objects and other views intact.

**Daily page** opens a daily date picker. **Open daily page** reuses that day’s page or creates it once. A daily page in Trash is offered for explicit restoration, never silently replaced. The page date is independent of its title and creation timestamp; changing it cannot overwrite another day’s page. Generic Daily Page creation also rejects duplicates while retaining the submitted draft. Today uses the browser’s local day with JavaScript and the server’s local day otherwise; an explicitly chosen date takes precedence.

**People** opens a built-in relationship directory with grouped initials cards and a selected-person detail panel. Create a **Person**, set Relationship (for example Family or Close friends), and optionally fill Birthday, Phone number, Job title, Favorite artists, Last connected, and Reconnect every (months). The next reconnect date is calculated from Last connected plus 1–120 whole months, clamping month ends (January 31 + one month becomes February 28 or 29). Missing inputs produce no date. Update Last connected after meeting; no notifications or automatic object writes occur. Notes remain ordinary Markdown. Search and native pagination cover 50 people per page; selecting a card works without JavaScript. This is a built-in screen, not a new AI-generated component.

Supported trusted components: list, table, calendar agenda, and board. A view can combine types through explicit stable-ID bindings. A calendar does not require a Task subclass or a common property label—only a compatible temporal property for each source. Events and Reminders have mutually exclusive all-day/timed fields: use separate calendar blocks for these representations and a nonempty filter on each bound field, without excluding genuinely undated tasks. Structural compatibility does not itself grant a write command.

**Objects** (at `/objects`) opens a type overview with totals for objects, types, and saved views—not a mixed feed. Choose a type there to browse only its objects. Each type offers **List** and **Gallery** layouts; gallery cards show the title, a plain-text excerpt of saved writing, and the last-updated date. Layout controls work without JavaScript and preserve the current search, page, and trash scope. These are built-in browse layouts, not AI-authored saved views.

The sidebar holds **New note**, **Calendar**, Objects, Search, server-stored Favorites, Views, pinned views, Manage types, and Trash. Opening Taskdesk (**/**, same as **Calendar**) shows the day workspace: the server-local selected day, its Daily Page editor, canonical Task objects scheduled or due that date, and live objects created during that local day. Tasks matching both Scheduled and Due appear once with both indicators, and completed tasks remain visible. Favorites are explicit shared workspace metadata; favoriting does not change object revisions and trashed favorites are hidden until restored. Search remains available across types.

With JavaScript, **Search** or **Ctrl/Command+K** opens object search without leaving your current draft. Search titles and writing, use arrow keys or Tab to choose a result, and press Enter to open it. **Insert object link** uses the same dialog, but selecting a result inserts a link at the writing selection instead of navigating. Reference fields and view input pickers add **Find object**, which searches the full collection for that reference type and changes only the existing select; you still save, show the view, or submit the action explicitly. Escape cancels without changing the draft or selection. These enhanced searches return up to 50 matches and ask you to narrow truncated results; native controls remain bounded fallbacks without JavaScript.

The **View assistant** opens on the right, resizes on desktop, and becomes a drawer on smaller screens. Closing it or navigating does not discard the current conversation or typed prompt. Navigation does not silently change its target. **Create view** and the assistant’s **New conversation** control start fresh. If generation finishes while an object has unsaved edits, it leaves those edits in place and offers a preview link instead of navigating away.

In a fresh, empty new-view conversation, optional starter suggestions fill and focus the composer locally. They never submit, call the provider, or overwrite an existing prompt—even whitespace. They stay hidden during refinement, in active/saved threads, and while restoring or generating. Review the prompt and explicitly choose **Generate view**; native forms remain the baseline without JavaScript.

Successful conversation turns are stored in SQLite and scoped to the browser visitor cookie. The active thread, unsent prompt, and panel visibility are remembered for the current browser tab; pins and panel width are local browser preferences. The assistant creates views, not arbitrary chat replies or object edits.

The model receives your prompt, up to 12 earlier prompts in the conversation, type/property metadata, and the prior declarative specification when refining. It does **not** receive object titles or writing unless you include them in a prompt. The configured provider processes that information. Generated HTML, JavaScript, SQL, and arbitrary code are not accepted.

See the [quick start](docs/quickstart.md) and [object/view contract](docs/object-contract.md) for detailed behavior and boundaries.

## Storage

SQLite stores canonical objects, Markdown bodies, shared property definitions, types, saved views, view conversations, revisions, and derived backlinks. Writing uses a native Markdown textarea in a clean parchment sheet, with grouped formatting icons, an **Edit / Preview** toggle, and a collapsible **Formatting guide**—no editor framework or persisted editor JSON. Toolbar buttons have accessible names and hover hints; **Insert object link** lives in the editor footer. Commands edit the selected text or lines without reserializing the document. Initialization, title/property-only enhanced saves, and undo back to the original text preserve the exact original Markdown. Writing edits and browser-native submissions can normalize line endings. The textarea remains usable without JavaScript or if writing tools fail to load. Preview renders the current draft through the same safe Bun renderer as saved writing, without saving or calling a model; raw HTML remains text, unsafe link targets are not clickable, and images remain inert text placeholders.

Object pages link directly to **Writing**, **Linked from**, and **History**. Linked from displays 50 incoming property or writing links per page with Previous/Next links when more remain. History is read-only: it lists saved snapshots, shows one selected snapshot's title, type, properties, rendered writing, and exact Markdown source, and can open that snapshot as an unsaved draft for the same object. Opening a draft never restores Trash or changes data; an explicit normal save is still revision-checked and validated against the current schema. Enhanced writing switches between Markdown source and a read-only draft preview; without JavaScript, **Read saved writing** shows the last saved version. A conflicting save keeps your draft and shows the latest saved title, type, properties, and writing for comparison. Reconcile the draft, then choose **Save reconciled changes**; a further concurrent edit still rejects the save. This works with and without JavaScript.

Save feedback stays beside the save button instead of appearing in duplicate page banners. With JavaScript, the same area shows the saved revision, unsaved changes, saving progress, or an error. Native forms show confirmation or errors there too, with a reminder that further edits still require saving.

The object workspace is the only supported application. Startup seeds the demo transactionally when first initializing an object database, or opens an existing workspace unchanged. It never reseeds an existing workspace, even after its objects are trashed or its views deleted. Demo dates are relative to the server's local initialization day and stay fixed afterward; timed examples use explicit UTC times. Startup does not import or migrate historical issue/vault data. Existing object data and visitor-owned view conversations remain usable. Unrelated tables and files are left untouched, not converted or deleted. Back up SQLite before upgrading; see the quick start.

Object schema version 7 is a fresh-only fixed-domain format. Existing object database versions 1–6, incomplete application schemas, and newer unknown versions are refused with instructions to choose a new database path. Taskdesk does not delete, reset, or migrate those files.

## Implementation

Bun supplies the HTTP server, SQLite driver, browser bundler, saved-Markdown renderer, HTML rewriting, file responses, cookie handling, hashing, and test runner. Hono supplies trusted JSX rendering, not routing. A small, optional same-origin browser bundle adds Markdown formatting commands and explicit draft preview to the native textarea. Toolbar edits use the browser's native undo history; if the browser cannot apply an undoable edit, it explains that source should be edited directly. Native saving never waits for these tools; the HTTP and SQLite contract remains Markdown.

- `src/server.ts`, `src/visitors.ts`: secured local HTTP and persistent visitor identity/CSRF state.
- `src/objects/model.ts`: shared types and closed declarative view schema.
- `src/schema.ts`: the single application SQLite schema owner, version upgrade coordinator, structural storage guards, and built-in protection triggers.
- `src/objects/workspace.ts`, `demo.ts`: atomic first-initialization demo using canonical object and view commands, with no model calls or separate sample store.
- `src/objects/runtime.ts`: canonical objects, property validation, revisions, commands, and backlinks.
- `src/objects/values.ts`: dependency-light scalar and temporal validation.
- `src/objects/markdown.ts`: bounded Markdown source, safe Bun rendering, search text, and link extraction.
- `src/objects/writing.ts`, `writing-commands.ts`, `writing-links.ts`: textarea enhancement, bounded draft preview, selection-based Markdown commands, and the shared safe-link policy.
- `src/objects/views.ts`: persistent view lifecycle, prepared bounded queries, and scoped commands.
- `src/objects/conversations.ts`: visitor-owned view threads and atomic draft/turn persistence.
- `src/objects/generator.ts`: isolated metadata-only Pi generation and validated submission.
- `src/objects/http.ts`, `render.tsx`, `client.ts`: native forms, domain screens, trusted view components, and progressive enhancement.
- `src/ui/`: reusable native atoms, fields, surfaces, feedback, page compositions, and the `/design-system` reference.
- `public/tokens.css`, `public/ui.css`, `public/objects.css`, `public/writing.css`: Hearthwood tokens, shared materials/components, responsive domain layouts, and Markdown writing/preview controls. Artwork and fonts live in `public/balaur/`.

```sh
bun run check
bun test
bun run sqlite:runtime
```

## Design system

The UI implements **Balaur / Basm Hearthwood**: oak-and-wood chrome, parchment content, pixel-art icons, square beveled controls, and hard shadows. Locally hosted Jersey 15, Piazzolla, JetBrains Mono, and Silkscreen supply the type roles. The page follows the system color preference; wood and parchment keep their distinct materials in both schemes. Reduced motion disables press movement.

The architecture is **tokens → semantic material roles → native atoms → compositions → domain screens**. Import reusable controls from `src/ui/index.ts`; `public/ui.css` owns their styles and `public/objects.css` owns Taskdesk layouts. The existing Hono JSX renderer remains the only component framework. Forms work without JavaScript; buttons act and links navigate. Submit buttons opt in explicitly:

```tsx
<>
  <Button type="submit" variant="primary">Save changes</Button>
  <ButtonLink href="/views">Back to views</ButtonLink>
</>
```

Open **`/design-system`**, linked from the footer, to inspect the actual shared controls and states. See [the UI component guide](docs/design-system.md) for component APIs, file ownership, design-source provenance, and extension rules. Use material roles rather than per-screen palette constants, and preserve native validation, visible focus, disabled/pressed states, and draft/revision hooks. This is a visual and component-system integration, not an import of Balaur's companion-specific features.

## Current boundaries

No live type inheritance, generated plugins, arbitrary model execution, synchronization, attachment storage, notification delivery, or per-object sharing permissions. The six domains and their fields are fixed in code. There are no custom types, user-created properties, select fields, structured references, or schema-label edits. Connections are ordinary Markdown links with derived backlinks.

Browse pages show 50 lightweight object summaries and read bounded derived body_text only for gallery excerpts; full Markdown bodies load only for canonical object reads. Object history shows 20 historical revisions per page and loads full body content only for the selected revision. Generated blocks show up to 100 rows with an explicit truncation notice. Refine the prompt to narrow larger result sets. Enhanced object, writing-link, reference, and view-input search return at most 50 matches and explicitly ask you to narrow truncated results. Native reference pickers are bounded to 200 live candidates per target type; native view input pickers show up to 200 candidates. Existing selections remain visible. Calendar agendas group by the stored start date, not a month grid or recurrence engine.
