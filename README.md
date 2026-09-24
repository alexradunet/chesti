# Taskdesk

A small experiment in **conversational, task-specific interfaces** using hypermedia, native HTML, and the Pi SDK.

A persistent conversation sits beside a working **Today workspace** backed by SQLite, or the original issue desk. Pi can inspect approved records, execute declared actions, and assemble the view. The server owns permissions, validation, transactions and JSX-rendered HTML.

**One agent, three capabilities: `inspect`, `act`, `present`.** No React, generated JavaScript, or model-owned application logic.

## A working SQLite Today workspace

Run `bun start`, open **http://127.0.0.1:3000/**, then click **Approve all 4 apps** in Quick setup to enable the sample with all declared permissions, including ordinary-note access. Or use **App review** to inspect each definition and select individual permissions. Home opens the persistent Today workspace directly; nothing is automatically activated. Bulk approval applies only to the displayed valid definitions and exact revisions, not future apps or edits.

The live database is `.data/taskdesk.sqlite` (`DATABASE_PATH` overrides it). First startup imports `.data/vault` if present, otherwise the fictional `examples/life-vault`; `VAULT_ROOT` selects a different initial import. Existing `.data/state.json` conversations and legacy vault approvals/receipts are imported once. Source files remain untouched. After import, SQLite is authoritative: editing old Markdown files does not update the app.

Today contains today's events and scheduled work, unfinished tasks, an editable daily Markdown journal, PARA links, and the same persistent conversation sidebar. Calendar links open a dated agenda. Task forms support deadlines, explicitly zoned work sessions, and completion. “Link in journal” inserts a wiki link into the draft; **Save journal** commits it.

The interface uses readable body text, larger controls, clear focus states and locally scrolling tables. On narrow screens, the workspace comes before conversation; **Workspace / Conversation** links jump between them without replacing either panel. Today summarizes visible schedule items and unfinished tasks, keeps upcoming dates collapsed, and labels PARA as **Notes & projects**.

Enhanced forms show unsaved, saving and error feedback beside the form, with save confirmation in the workspace. Resource navigation preserves an unsent conversation draft and updates the page title and keyboard focus. Selecting a record synchronizes every visible copy of its checkbox. The server-rendered forms remain usable without JavaScript.

Try **“Create a task to finish the homepage tomorrow.”** The credential-free demo supports this exact grammar; select Pi for open-ended requests. Both use `inspect`, `act`, and `present`, and the same validated mutation boundary as browser forms. Pi cannot approve apps or access arbitrary files.

Explicit definition imports become pending review and revoke their previous grants. Updates check record and definition revisions, validate prospective relationships/uniqueness, and preserve untouched Markdown and YAML formatting for export. Record changes, durable runtime receipts and browser conversation receipts commit in one SQLite transaction.

Markdown remains a content and interchange format. `bun run lifeapps check examples/life-vault` is read-only; explicit `import`, `export` and `definition` commands manage interchange. See the [quick start](docs/vault-quickstart.md) and [implemented app contract](docs/app-definition-v1.md). Automatic record-schema evolution and conversational app creation remain outside this iteration.

## Run

Bun **1.4.2+** and a current browser:

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:3000**. The server binds only to loopback.

The default is a credential-free **Deterministic demo**. Home is Today; the original issue composer is a secondary destination at **http://127.0.0.1:3000/issues/new**. There, create a triage workspace and try the conversation:

- “Assign both issues to me” → assigns the two visible issues to Alex, without changing the layout.
- “Assign selected issues to me” → select issues using the workspace checkboxes first.
- “Close ISS-101” → creates a confirmation receipt; nothing closes until you confirm it.
- “Show my work” → changes the layout to your unfinished work.

Demo conversation supports a deliberately small command grammar, not general language understanding. It labels every response **DEMO · NO AI**. Choose Pi for open-ended conversation.

### Use Pi

Select **Pi SDK** in the conversation. To make Pi the initial composer too:

```sh
COMPOSER=pi PI_MODEL=openai-codex/gpt-5.5 bun start
```

`PI_MODEL` is an exact `provider/model-id` available to your Pi installation. Existing Pi authentication is reused; provider environment API keys also work through `ModelRuntime`. Personal extensions, coding tools, skills, prompt templates, settings and context files are not loaded.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Loopback HTTP port |
| `COMPOSER` | `demo` | Initial composer choice: `demo` or `pi` |
| `PI_MODEL` | Saved composition/session model, otherwise the SDK's provider default | Exact provider/model ID; overrides restored selections |
| `PI_AUTH_PATH` | Pi's normal auth file | Optional separate credentials |
| `PI_MODELS_PATH` | Pi's normal models file | Optional custom model definitions |
| `DATABASE_PATH` | `.data/taskdesk.sqlite` | Single authoritative SQLite database |
| `VAULT_ROOT` | Existing `.data/vault`, otherwise `examples/life-vault` | Initial Markdown import only; ignored once app records are initialized |

Bun loads `.env` files using its normal runtime behavior; exported environment variables take precedence. The Pi SDK is pinned to **0.86.1**.

**Privacy:** Pi receives conversation history, workspace context, action receipts, and inspected approved vault/issue data. Credentials remain server-side and are not exposed through agent tools. Selecting Pi is opt-in. The SDK selects a provider default for new sessions rather than the catalog's first authenticated model: catalog membership does not guarantee account entitlement. Set an exact supported `PI_MODEL` to override an unavailable saved model; provider failures do not fall back to another executor. Provider error details are logged server-side, not exposed in the browser.

## What the next iteration adds

- **Persistent sidebar:** conversation survives refresh, resource navigation and server restarts. Enhanced resource navigation keeps the live response open.
- **Streaming and Stop:** replies arrive as text over a POST event stream. Stopping prevents subsequent tools; it does not undo completed actions.
- **Shared context:** each turn knows its initiating view, explicit issue selection, local actor, recent conversation and action receipts. Pi must inspect fresh state before acting.
- **Optional layout changes:** a question can produce only a reply. Assigning an issue updates data without recomposition. `present` explicitly changes the view.
- **Safe form handling:** unfinished workspace forms are not silently overwritten by incoming view/data updates. Apply the queued refresh explicitly, or finish the form.
- **Action receipts:** each action shows its issue, parameters, and applied/pending/failed/cancelled outcome. Browser form actions within the workspace are recorded too.
- **One-step layout undo:** restores the previous composition, not issue mutations.

The sidebar is always available; **the agent is not always running**. Reading a page, following a resource link, confirming an action, or submitting a native issue form does not call a model.

## Hypermedia, not two application implementations

```text
Conversation                       Workspace
     │                                 │
Pi: inspect → act                 HTML form POST
                 └─────┬───────────────┘
                       ▼
          Same current-state validation
           + version check + mutation
                       ▼
          Persist state and action receipt
                       ▼
              Fresh server-rendered HTML

Pi: present → validated view plan → saved composition
```

Resources advertise links, facts and available actions. Closing an issue removes editing actions and exposes reopening. Pi cannot invent an endpoint or access an arbitrary URL: discovery starts at `/vault` or `/issues`, plus server-supplied visible, focus and layout resources, and follows advertised links. Pi navigates these resources itself; the user need not open or select a journal entry before requesting an update.

Before `act`, Pi must explicitly inspect the target record in the **current turn**. Visibility or an embedded collection item permits discovery, not writing. The server binds the action to that inspected version and resolves its fields from the advertised action. The agent cannot supply credentials, a different principal, a confirmation flag, or override version metadata.

For this local sandbox, **“me” is Alex**, the server-defined actor. This is not a real multi-user login system; the browser cookie isolates the seeded sandbox and acts as a local bearer credential.

### Execution policy

- Assignment, priority, start and reopen are routine actions and execute directly after a clear user request.
- Agent-requested **close** actions create pending receipts. A CSRF-protected user confirmation is required. A native “Close issue” button is itself that explicit user action.
- Ambiguous language is resolved by Pi, which is instructed to ask rather than guess. This semantic check is a model responsibility, not a deterministic natural-language authorization proof. The offline demo refuses “both” without a two-issue view or selection.
- Stale state fails instead of silently overwriting a concurrent edit. A failed operation is not retried automatically within the turn.
- Repeated HTTP message IDs replay the original completed turn. Duplicate action intentions within a turn replay server-generated receipts, even after re-inspection.
- Individual actions are **not an atomic batch**. Partial completion remains visible if a later action fails or the model is stopped.
- State and receipts are written together before acknowledging an action. A persistence failure rolls the mutation back in memory.

Initial read-only composition can fall back to an explicitly labeled deterministic view. **Conversation/action failures never fall back to another executor**, because earlier actions may already have applied.

## The composition contract

`src/core.ts` holds the small reusable boundary: resource representations, hypermedia traversal and view validation.

```json
{
  "title": "Triage queue",
  "layout": "split",
  "blocks": [
    { "resource": "/issues?scope=triage", "view": "table" },
    { "resource": "/issues/ISS-101", "view": "detail" },
    { "resource": "/issues/ISS-101", "view": "actions" }
  ]
}
```

Up to five blocks, with `split`/`stack` layouts and `table`/`list`/`detail`/`actions` presentations. Only explicitly inspected resources can be presented. Pi supplies neither HTML nor CSS, methods, action URLs, fields or event handlers.

A plan stores references, not snapshots. Current facts and available forms are resolved on every render. An issue can leave a queue while remaining in an explicitly selected focus panel; this does not automatically rewrite the layout.

Issue resources have two representations at the same URL:

- HTML for browser navigation.
- `application/vnd.taskdesk.resource+json` for the experimental resource contract.

```sh
curl -c /tmp/taskdesk.cookies \
  -H 'Accept: application/vnd.taskdesk.resource+json' \
  http://127.0.0.1:3000/issues

curl -b /tmp/taskdesk.cookies \
  -H 'Accept: application/vnd.taskdesk.resource+json' \
  'http://127.0.0.1:3000/issues?scope=triage'
```

Pi uses the same resolver in-process. Today starts discovery at `/vault`, which links approved types, collections, views, records and ordinary notes. Creation actions live on `/vault/types/<qualified-type>` resources. App approval is a separate CSRF-protected browser route, not an advertised agent action. This media type remains app-specific.

## Browser implementation

Server-side JSX (`hono/jsx`) renders semantic HTML, native links and forms, native input constraints, and `<details>`. Bun transpiles TSX directly; no React or hydration is used. CSS Grid, `:has()`, container queries and reduced-motion-aware cross-document transitions provide the layout. IBM Plex Sans is served locally. Markdown is rendered through a trusted CommonMark subset; raw HTML is escaped and images are not fetched.

One **trusted, hand-written** `public/workspace.js` enhances conversation streaming, same-workspace navigation, form submission, selection and deferred workspace updates. Model prose is inserted as text, never parsed as HTML. HTML fragments only come from the escaping server renderer. CSP permits same-origin scripts/connections, not inline scripts or generated handlers.

Without JavaScript, conversations and actions still work through normal POST/redirect/GET, but replies arrive at completion and navigation reloads the document. Unsupported View Transitions are ordinary navigation. There is no frontend framework or separate build pipeline. Bun runs the HTTP server, TypeScript, package installation and test runner; `tsc` remains the explicit type checker.

## Persistence and lifecycle

`.data/taskdesk.sqlite` stores browser sandboxes, issues, compositions, turns, SDK session entries, receipts, app definitions and revision history, grants, structured records and reference edges. Dynamic fields and view plans use validated JSON; record bodies remain Markdown. Preserved source text is a formatting cache for lossless interchange, not a live filesystem store. The database is ignored by Git and uses restrictive file permissions, foreign keys, WAL and `synchronous=FULL`. Browser and app schemas have explicit version checks.

Startup imports legacy data once without overwriting its source. The old `.lifeapps/runtime.json` journal is interpreted conservatively: an already-published content hash can be recognized, but an interrupted write is never replayed. Browser intents are reconciled with imported receipts. New actions commit their records and both receipts together; persistence failures roll back the transaction and in-memory receipt.

App records and approvals are **shared by local browser sessions**; conversations and original issue sandboxes remain browser-specific. This is not multi-user authorization.

Each Pi turn restores an isolated in-memory SDK session from that workspace's saved entries, then disposes it after completion. No agent is kept running while idle. Application state is independent of the transcript. A turn that was running at server restart is marked stopped; it is never automatically rerun. Pending confirmations and completed receipts survive restarts.

Limits: initial composition has a 45-second deadline and 12 tool attempts; conversation turns have 60 seconds and 24 tool attempts, without provider retries. One turn per workspace, up to four concurrent conversations. A sandbox holds at most 50 workspaces; conversations stop at 100 turns or roughly 1 MB of SDK history. Start a new workspace at that point; automatic compaction is deliberately absent.

This is **single-process and loopback-only**. It includes CSRF/origin/host checks, body limits, capability allowlists, revision checks and HTML escaping. Interchange rejects unsafe/incomplete/invalid sources and visible non-Markdown assets instead of silently dropping them. Runtime receipts remain bounded to 10,000 entries. Stop the app before replacing/restoring its database. For a complete backup, use a SQLite-aware backup or stop all connections and copy the database with any remaining `-wal`/`-shm` sidecars; copying only a live WAL database file can lose committed data. Markdown export includes app data/grants/receipts, **not** browser conversations.

## Files

```text
src/core.ts          Resource contract, traversal and view validation
src/issues.ts        Issue facts, affordances and domain transitions
src/conversation.ts  Shared execution boundary, receipts, turn context, demo chat
src/pi.ts            Isolated initial Pi composer and resource loader
src/pi-chat.ts       Multi-turn Pi adapter: inspect + act + present
src/chat-http.ts     Conversation HTTP/SSE, cancellation and replay handling
src/composer.ts      Initial composition selection and read-only fallback
src/render.tsx       Trusted server JSX, sidebar and workspace fragments
src/server.ts        Native Bun HTTP, form handling and request protections
src/database.ts      Private SQLite connection, WAL and foreign-key setup
src/store.ts         Relational browser persistence and legacy import
public/style.css     Shared visual system and responsive conversation rail
public/workspace.js  Small trusted enhancement client; no generated code
scripts/smoke-pi.ts   Opt-in real-provider, multi-turn/restart smoke test
scripts/lifeapps.ts   Markdown check/schema, SQLite import/export and definition updates
src/vault/           Validation, SQLite runtime/interchange, resources and Today JSX
examples/life-vault/  Fictional, connected Markdown app examples
docs/                Vault quick start and implemented contract
test/                Core, HTTP, DOM-client, vault and Pi isolation tests
```

## Verification

```sh
bun run check
bun test
```

The **129 credential-free tests** cover resource traversal, shared action validation, streaming/Stop/disconnect/replay, browser dirty-form behavior, synchronized selections, inline save failures, navigation/refresh races, JSX escaping, grants and atomic bulk approval, imported formatting, stale revisions, uniqueness/references, transactional record/receipt rollback, restart recovery and Markdown interchange. The enhanced form tests exercise the real client against the Bun HTTP server.

Optional live-provider test (consumes your configured model quota; uses a temporary sandbox, not your working issues):

```sh
PI_MODEL=openai-codex/gpt-5.5 bun run smoke:pi
```

Passed under Bun 1.4.2 with `openai-codex/gpt-5.5`: assigned ISS-101 and ISS-105, restarted the server/store, recalled the assignment without changing anything, then recomposed the workspace without further issue mutations.

**Today browser smoke passed** in Chromium at desktop and 390px widths against a disposable SQLite database: explicit approvals, streamed demo task creation, native completion, journal creation/editing, unsaved-draft protection, server restart with restored conversation/data, and JavaScript-disabled form submission. Markdown export validated and reimported successfully. No cross-browser claim is made.

**Readability browser smoke passed** in Chromium at 1440px, 390px and 320px widths against a disposable SQLite database. Checked Today, resource tables, app review and issue workspaces for page overflow; exercised mobile panel links, keyboard skip navigation, journal saving, demo task creation, native completion, draft-preserving resource navigation, and JavaScript-disabled journal submission.
