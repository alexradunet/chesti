# Taskdesk

An experiment in **assembling the interface for the current task** using hypermedia, native HTML, and the Pi SDK.

The application decides what is possible. Pi selects and arranges the relevant resources. The server renders HTML. The browser follows links and submits forms.

No React, generated JavaScript, client-side router, custom UI language, or inference on ordinary interactions.

## Run

Node **22.6+** (tested on Node 26), npm, and a modern browser:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The server binds only to loopback.

The default is **Deterministic demo**. Try:

- “Help me triage unassigned issues” → a comparison table with a focused issue and its forms.
- “What should I work on next?” → a priority-ordered list of Alex’s unfinished work.

Demo mode uses keyword rules; it is deliberately **not** advertised as AI. Its only purpose is to make the interaction model testable without credentials.

### Compose with Pi

Select **Pi SDK · configured model** in the task form. Existing Pi authentication is reused; the app does not load personal extensions, tools, skills, prompt templates, or context files.

To make Pi the default and explicitly choose a model:

```sh
COMPOSER=pi PI_MODEL=openai-codex/gpt-5.5 npm start
```

`PI_MODEL` is the exact `provider/model-id` available to your Pi installation. Omit it to use the first authenticated model. Provider environment API keys also work through Pi's `ModelRuntime`.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Loopback HTTP port |
| `COMPOSER` | `demo` | Default form choice (`demo` or `pi`) |
| `PI_MODEL` | First authenticated model | Exact provider/model ID |
| `PI_AUTH_PATH` | Pi's normal auth file | Optional separate credentials |
| `PI_MODELS_PATH` | Pi's normal models file | Optional custom model definitions |

No `.env` loader is implicit: export variables or prefix the command as above. The SDK is pinned to **0.86.1**, matching the local SDK documentation used for this prototype.

**Privacy:** Pi mode sends the task and inspected demo issue data to your selected provider. It is opt-in on each submission unless you choose `COMPOSER=pi`. Composition is bounded to 12 tool attempts and a 45-second deadline; provider retries are disabled. The local server accepts one composition at a time.

If composition fails, the workspace says **FALLBACK · NO AI VIEW** and uses deterministic rules. Server logs contain the failure reason. The application does not pretend a fallback was model-generated.

## The small core

```text
POST /workspaces (task)
          │
          ▼
  Pi: inspect("/issues")
          │ discover links, inspect relevant resources
          ▼
  Pi: present(viewPlan)
          │ validate shape + references + presentation compatibility
          ▼
  Save plan → 303 → GET /workspaces/:id → HTML
                                      │
                           follow link / submit form
                                      │
                           validate current state
                                      │
                             303 → updated HTML
```

The framework boundary is `src/core.ts`:

- **Resource:** authoritative facts, embedded items, discoverable links, current forms.
- **Explorer:** initially knows only `/issues`; refuses to inspect invented or external URLs. A resource must be explicitly inspected before it can be presented.
- **View plan:** title, `split` or `stack`, and up to five blocks. A block references a resource and selects `table`, `list`, `detail`, or `actions`.

Example internal plan:

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

This is private planning data, not a new browser protocol. The browser receives HTML. The model never supplies HTML, CSS, endpoints, methods, field definitions, tokens, or event handlers.

`src/issues.ts` and parts of the renderer are intentionally issue-specific. This is a reference experiment, **not yet a published, general-purpose framework**. Add a second domain before extracting a larger API.

## Why this is hypermedia

Both the browser and the composer discover the next available operations from resource representations, instead of maintaining their own transition logic.

Closing an issue removes assignment, priority, start, and close forms; the next representation offers only reopening. Every submission checks the **current** affordance, its allowed field values, and the resource version. Old forms return `409`, even if their buttons used to be available.

The same resource URL offers two representations:

- `text/html` for the browser.
- `application/vnd.taskdesk.resource+json` for inspecting the resource contract. This is an experimental app-specific media type, not a standardized format.

```sh
curl -c /tmp/taskdesk.cookies \
  -H 'Accept: application/vnd.taskdesk.resource+json' \
  http://127.0.0.1:3000/issues

curl -b /tmp/taskdesk.cookies \
  -H 'Accept: application/vnd.taskdesk.resource+json' \
  'http://127.0.0.1:3000/issues?scope=triage'
```

Pi calls that same application resolver in-process. It is read-only and does not receive browser CSRF credentials. Actual changes are made by the user through the trusted HTML forms.

## Native browser features

- Semantic headings, tables, lists, landmarks and labeled controls.
- Real GET links and POST forms, including buttons associated with forms using `form="id"`.
- Native `required` / `maxlength` checks, supplemented by server validation.
- Native popovers for explaining action availability; `<details>` for inspecting the accepted view plan.
- CSS Grid, `:has()`, a container query, and reduced-motion-aware cross-document View Transitions.
- Locally served IBM Plex Sans; no CDN, build pipeline, or third-party browser requests.
- Strict CSP with **no scripts**, inline event handlers, or inline styles.

Use current Chrome, Firefox, or Safari. View Transitions are enhancement-only; unsupported browsers perform ordinary navigation. Popovers are baseline modern-browser features, not a dependency of task completion. Dialogs, custom elements, Shadow DOM, htmx, streaming, and DOM patching were deliberately left out because this slice does not need them.

## Saved workspaces and state

`.data/state.json` holds issues, browser sandboxes, and accepted view plans. It is ignored by Git and created with restrictive permissions. Writes use an atomic rename. Pi sessions are isolated, in-memory, and disposed after composition; transcripts are not used as a database.

Each browser cookie identifies a separate seeded sandbox, acting as a local bearer credential. Workspace URLs survive refresh and server restarts **in that sandbox**. They are not public sharing links. The local prototype caps itself at 100 browser sandboxes and 50 workspaces per sandbox.

A workspace stores references, not snapshots. Refreshing resolves current facts and forms **without inference**. Following an issue link opens its canonical detail page, with a link back to the saved workspace. If the issue leaves the queue, an explicitly selected focus panel can remain visible; the plan is intentionally not automatically rewritten. An empty queue gets a deterministic empty state.

This is a single-process, loopback-only prototype. It has CSRF tokens, origin/host checks, isolated sandbox lookup, field allowlists, optimistic concurrency and HTML escaping. It does **not** have real accounts, production authorization, HTTPS deployment configuration, a multi-process database, or a distributed rate limiter. Do not expose it publicly unchanged.

## Files

```text
src/core.ts       Resource contract, traversal boundary, view validation
src/issues.ts     Issue domain, links, forms and state transitions
src/pi.ts         Embedded Pi session: inspect + present only
src/composer.ts   Pi adapter selection and explicit deterministic fallback
src/render.ts     Trusted semantic HTML renderer and application shell
src/server.ts     HTTP, form handling, request protections and redirects
src/store.ts      Local state persistence
public/style.css  One stylesheet; no client JavaScript
test/            Core, real-HTTP and SDK isolation tests
```

## Verify

```sh
npm run check
npm test
```

Tests cover discovery, invalid plans, output escaping, action availability, stale submissions, actual HTTP navigation and form cycles, content negotiation, CSRF/origin/host checks, sandbox isolation, persistence, fresh data under saved plans, no recomposition on mutations, and Pi resource-loader isolation. They do not require credentials or call a model.

A live Pi SDK smoke test also succeeded with `openai-codex/gpt-5.5`, discovering the triage queue and accepting a view in approximately nine seconds. This is a smoke test, not a guarantee for other providers or future model behavior.

**Visual verification is pending:** the local Interceptor browser gate reported `INTERCEPTOR_TEST_CONTEXT_ID is not set`. No screenshot or cross-browser layout verification is claimed.
