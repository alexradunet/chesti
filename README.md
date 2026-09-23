# Taskdesk

A small experiment in **conversational, task-specific interfaces** using hypermedia, native HTML, and the Pi SDK.

A persistent conversation sits beside a working **Today workspace** backed by Markdown files, or the original issue desk. Pi can inspect approved records, execute declared actions, and assemble the view. The server owns permissions, validation, writes and HTML.

**One agent, three capabilities: `inspect`, `act`, `present`.** No React, generated JavaScript, or model-owned application logic.

## A working Markdown Today workspace

Run `npm start`, open **http://127.0.0.1:3000/today**, then use **App review** to approve each definition revision and its individual permissions. Nothing is automatically activated.

The default vault is a writable copy of the fictional sample at `.data/vault`; `examples/life-vault` remains unchanged. Set `VAULT_ROOT=/absolute/path/to/vault` to use another vault containing `.apps/`. No personal vault is discovered automatically.

Today contains today's events and scheduled work, unfinished tasks, an editable daily Markdown journal, PARA links, and the same persistent conversation sidebar. Calendar links open a dated agenda. Task forms support deadlines, explicitly zoned work sessions, and completion. “Link in journal” inserts a wiki link into the draft; **Save journal** commits it.

Try **“Create a task to finish the homepage tomorrow.”** The credential-free demo supports this exact grammar; select Pi for open-ended requests. Both use `inspect`, `act`, and `present`, and the same validated mutation boundary as browser forms. Pi cannot approve apps or access arbitrary files.

Definitions edited externally become pending review and their capabilities are suspended. Updates check content and definition revisions, validate prospective relationships/uniqueness, and preserve untouched YAML tokens, comments, and Markdown. Journaled writes and durable receipts survive restart without replaying interrupted edits over external changes.

The read-only CLI remains available: `npm run lifeapps -- check examples/life-vault`. See the [quick start](docs/vault-quickstart.md) and [implemented app contract](docs/app-definition-v1.md). Migrations and conversational app creation remain outside this milestone.

## Run

Node **22.6+** (tested on Node 26), npm, and a current browser:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The server binds only to loopback.

The default is a credential-free **Deterministic demo**. Create a triage workspace, then try the conversation:

- “Assign both issues to me” → assigns the two visible issues to Alex, without changing the layout.
- “Assign selected issues to me” → select issues using the workspace checkboxes first.
- “Close ISS-101” → creates a confirmation receipt; nothing closes until you confirm it.
- “Show my work” → changes the layout to your unfinished work.

Demo conversation supports a deliberately small command grammar, not general language understanding. It labels every response **DEMO · NO AI**. Choose Pi for open-ended conversation.

### Use Pi

Select **Pi SDK** in the conversation. To make Pi the initial composer too:

```sh
COMPOSER=pi PI_MODEL=openai-codex/gpt-5.5 npm start
```

`PI_MODEL` is an exact `provider/model-id` available to your Pi installation. Existing Pi authentication is reused; provider environment API keys also work through `ModelRuntime`. Personal extensions, coding tools, skills, prompt templates, settings and context files are not loaded.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Loopback HTTP port |
| `COMPOSER` | `demo` | Initial composer choice: `demo` or `pi` |
| `PI_MODEL` | Saved composition model, otherwise first authenticated model | Exact provider/model ID; initial composition has no saved model |
| `PI_AUTH_PATH` | Pi's normal auth file | Optional separate credentials |
| `PI_MODELS_PATH` | Pi's normal models file | Optional custom model definitions |
| `VAULT_ROOT` | `.data/vault` | Explicit Markdown vault; default is copied from fictional examples on first startup |

There is no implicit `.env` loader. Export variables or prefix commands. The SDK is pinned to **0.86.1**.

**Privacy:** Pi receives conversation history, workspace context, action receipts, and inspected approved vault/issue data. Credentials remain server-side and are not exposed through agent tools. Selecting Pi is opt-in. Set an exact supported `PI_MODEL` if the provider's first authenticated model is unavailable to your account; provider failures do not fall back to another executor.

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

Resources advertise links, facts and available actions. Closing an issue removes editing actions and exposes reopening. Pi cannot invent an endpoint or access an arbitrary URL: discovery begins at `/issues` and follows advertised links.

Before `act`, Pi must explicitly inspect the issue in the **current turn**. The server binds the action to that inspected version and resolves its fields from the advertised action. The agent cannot supply credentials, a different principal, a confirmation flag, or override version metadata.

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

Semantic server-rendered HTML, native links and forms, native input constraints, and `<details>`. CSS Grid, `:has()`, container queries and reduced-motion-aware cross-document transitions provide the layout. IBM Plex Sans is served locally. Markdown is rendered through a trusted CommonMark subset; raw HTML is escaped and images are not fetched.

One **trusted, hand-written** `public/workspace.js` enhances conversation streaming, same-workspace navigation, form submission, selection and deferred workspace updates. Model prose is inserted as text, never parsed as HTML. HTML fragments only come from the escaping server renderer. CSP permits same-origin scripts/connections, not inline scripts or generated handlers.

Without JavaScript, conversations and actions still work through normal POST/redirect/GET, but replies arrive at completion and navigation reloads the document. Unsupported View Transitions are ordinary navigation. There is no frontend framework or build pipeline.

## Persistence and lifecycle

`.data/state.json` stores browser sandboxes, issues, accepted compositions, conversation turns, SDK session entries and receipts. It is ignored by Git, uses restrictive file permissions, and is replaced with an atomic rename. Version-1 stores migrate in place without discarding issues or workspace URLs.

Vault records live in ordinary `.md` files. `<vault>/.lifeapps/runtime.json` holds exact definition approvals, grants, idempotent action receipts and the interrupted-write journal; back it up with the vault. Authority state and staged records are fsynced before publication. Recovery recognizes already-published content rather than blindly replaying a write. The conversation store records intent before execution and reconciles its receipt from the vault journal on restart.

The configured vault and its approvals are **shared by local browser sessions**; only conversations and the original issue sandboxes are browser-specific. This is not multi-user vault authorization.

Each Pi turn restores an isolated in-memory SDK session from that workspace's saved entries, then disposes it after completion. No agent is kept running while idle. Application state is independent of the transcript. A turn that was running at server restart is marked stopped; it is never automatically rerun. Pending confirmations and completed receipts survive restarts.

Limits: initial composition has a 45-second deadline and 12 tool attempts; conversation turns have 60 seconds and 24 tool attempts, without provider retries. One turn per workspace, up to four concurrent conversations. A sandbox holds at most 50 workspaces; conversations stop at 100 turns or roughly 1 MB of SDK history. Start a new workspace at that point; automatic compaction is deliberately absent.

This is **single-process and loopback-only**. It includes CSRF/origin/host checks, field/capability allowlists, revision checks, symlink/hardlink rejection and HTML escaping. Portable filesystem APIs cannot eliminate a hostile external process swapping directories or changing files in the final check-to-rename window. Use one app writer, keep backups, and do not expose it publicly. Vault receipts are bounded to 10,000 entries and authority state to 16 MiB; reaching capacity fails closed.

## Files

```text
src/core.ts          Resource contract, traversal and view validation
src/issues.ts        Issue facts, affordances and domain transitions
src/conversation.ts  Shared execution boundary, receipts, turn context, demo chat
src/pi.ts            Isolated initial Pi composer and resource loader
src/pi-chat.ts       Multi-turn Pi adapter: inspect + act + present
src/chat-http.ts     Conversation HTTP/SSE, cancellation and replay handling
src/composer.ts      Initial composition selection and read-only fallback
src/render.ts        Trusted HTML renderer, sidebar and workspace fragments
src/server.ts        HTTP, form handling and request protections
src/store.ts         Local persistence and migration
public/style.css     Shared visual system and responsive conversation rail
public/workspace.js  Small trusted enhancement client; no generated code
scripts/smoke-pi.ts   Opt-in real-provider, multi-turn/restart smoke test
scripts/lifeapps.ts   Read-only vault check and JSON Schema export
src/vault/           Parsing, validation, approval, safe writes, resources and Today UI
examples/life-vault/  Fictional, connected Markdown app examples
docs/                Vault quick start and implemented contract
test/                Core, HTTP, DOM-client, vault and Pi isolation tests
```

## Verification

```sh
npm run check
npm test
node --check public/workspace.js
```

The **117 credential-free tests** cover the original conversation/UI behavior, reader/CLI validation, approval/grant enforcement, external definition changes, lossless edits, stale revisions, prospective uniqueness/references, path hazards, durable receipt recovery after actual child-process interruptions, and the requested conversation → Markdown → browser scheduling → completion → journal → restart flow. The enhanced form test exercises the real client against the HTTP server.

Optional live-provider test (consumes your configured model quota; uses a temporary sandbox, not your working issues):

```sh
PI_MODEL=openai-codex/gpt-5.5 npm run smoke:pi
```

Passed with `openai-codex/gpt-5.5`: assigned ISS-101 and ISS-105, restarted the server/store, recalled the assignment without changing anything, then recomposed the workspace without further issue mutations.

**Today browser smoke passed** in Chromium at desktop and 390px widths. In a disposable vault, explicit app approvals enabled live Pi (`openai-codex/gpt-5.5`) task creation; native forms scheduled/completed the task; Pi appended its wiki link to the existing journal; native journal editing, PARA navigation, today's event creation, refresh and server restart preserved the files and conversation. The default-discovered `gpt-5.3-codex-spark` was rejected by the account, so this smoke explicitly selected the supported model. No cross-browser claim is made.
