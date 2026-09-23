# Taskdesk

A small experiment in **conversational, task-specific interfaces** using hypermedia, native HTML, and the Pi SDK.

A persistent conversation sits beside a working issue desk. Pi can answer questions, act on issues, and assemble the view. The server still owns the facts, allowed actions, validation and HTML.

**One agent, three capabilities: `inspect`, `act`, `present`.** No React, generated JavaScript, or model-owned application logic.

## Markdown mini-app foundation

The next layer is a **read-only Markdown vault reader and validator**. It checks declarative app definitions, typed documents, dates, relationships and wiki links without activating apps or changing files.

```sh
npm run lifeapps -- check examples/life-vault
# Direct execution also supports Bun:
bun scripts/lifeapps.ts check examples/life-vault --json
```

The fictional sample vault has Tasks, Calendar, Journal and Wiki definitions, six managed records, and three ordinary notes arranged around PARA. Existing Taskdesk UI/data and installed LifeOS data are not connected to this foundation yet.

See the [quick start](docs/vault-quickstart.md) and [implemented app-definition contract](docs/app-definition-v1.md). `lifeapps schema` exports the definition's JSON Schema. App installation, safe file writes, migrations, calendar rendering and Pi app-building are deliberately deferred.

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

There is no implicit `.env` loader. Export variables or prefix commands. The SDK is pinned to **0.86.1**.

**Privacy:** Pi receives conversation history, workspace context, action receipts, and inspected issue data. Credentials are managed by Pi on the server, not sent to the browser or exposed through agent tools. Selecting Pi is opt-in; a failed initial Pi composition keeps Pi selected for subsequent conversation turns.

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

Pi uses the same resolver in-process. This media type is app-specific, not a standardized hypermedia format. The issue domain and some renderer details remain issue-specific: this is a reference experiment, not a published framework.

## Browser implementation

Semantic server-rendered HTML, native links and forms, externally associated form controls, native input constraints, popovers and `<details>`. CSS Grid, `:has()`, container queries and reduced-motion-aware cross-document transitions provide the layout. IBM Plex Sans is served locally.

One **trusted, hand-written** `public/workspace.js` enhances conversation streaming, same-workspace navigation, form submission, selection and deferred workspace updates. Model prose is inserted as text, never parsed as HTML. HTML fragments only come from the escaping server renderer. CSP permits same-origin scripts/connections, not inline scripts or generated handlers.

Without JavaScript, conversations and actions still work through normal POST/redirect/GET, but replies arrive at completion and navigation reloads the document. Unsupported View Transitions are ordinary navigation. There is no frontend framework or build pipeline.

## Persistence and lifecycle

`.data/state.json` stores browser sandboxes, issues, accepted compositions, conversation turns, SDK session entries and receipts. It is ignored by Git, uses restrictive file permissions, and is replaced with an atomic rename. Version-1 stores migrate in place without discarding issues or workspace URLs.

Each Pi turn restores an isolated in-memory SDK session from that workspace's saved entries, then disposes it after completion. No agent is kept running while idle. Application state is independent of the transcript. A turn that was running at server restart is marked stopped; it is never automatically rerun. Pending confirmations and completed receipts survive restarts.

Limits: initial composition has a 45-second deadline and 12 tool attempts; conversation turns have 60 seconds and 24 tool attempts, without provider retries. One turn per workspace, up to four concurrent conversations. A sandbox holds at most 50 workspaces; conversations stop at 100 turns or roughly 1 MB of SDK history. Start a new workspace at that point; automatic compaction is deliberately absent.

This is **single-process and loopback-only**. It includes CSRF/origin/host checks, sandbox lookup, field allowlists, optimistic concurrency and HTML escaping. It does not provide production authentication, multi-process transactions, HTTPS deployment configuration or a distributed rate limiter. Do not expose it publicly unchanged.

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
src/vault/           Shared Markdown, definition and vault validation
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

The **101 credential-free tests** cover the original conversation/UI/domain behavior plus Markdown/YAML parsing, definition schemas and semantics, temporal validation, duplicate IDs and journal dates, typed references, wiki links, external edits, read-only behavior, path/symlink boundaries, bounded scans, and CLI output/exit codes. DOM-client tests use jsdom; they are not visual browser tests. The vault milestone changes no browser UI.

Optional live-provider test (consumes your configured model quota; uses a temporary sandbox, not your working issues):

```sh
PI_MODEL=openai-codex/gpt-5.5 npm run smoke:pi
```

Passed with `openai-codex/gpt-5.5`: assigned ISS-101 and ISS-105, restarted the server/store, recalled the assignment without changing anything, then recomposed the workspace without further issue mutations.

**Visual verification remains pending:** Interceptor's isolation gate reports `INTERCEPTOR_TEST_CONTEXT_ID is not set`. No screenshot or cross-browser visual verification is claimed.
