# Plan 013: Bind every application flow to an explicit workspace

> **Executor instructions:** Implementation needs a separate assignment; this plan only records the approved scope. Complete the prerequisite, follow the gates, and stop rather than adding compatibility paths. Historical commit/push permissions in `plans/README.md` are not current authorization. Your reviewer decides who updates the index.
>
> **Drift check first:** `git status --short` and `git diff --stat 133f8a6..HEAD -- src/server.ts src/workspaces.ts src/workspaces-http.ts src/workspaces-render.tsx src/objects/model.ts src/objects/http.ts src/objects/render.tsx src/objects/client.ts src/objects/ai-state.ts src/objects/writing.ts src/objects/writing-links.ts src/objects/markdown.ts src/objects/urls.ts public/objects.css test README.md docs/object-contract.md docs/quickstart.md AGENTS.md`. Changes implementing Plan 012 are expected; verify the prerequisite contract below. Stop on unrelated changes or incompatible differences, not merely because the prerequisite changed a cited line.

## Status

- **Priority:** P1 — prerequisite for safe memory access
- **Effort:** L
- **Risk:** HIGH — request routing, lost drafts, asynchronous scope, and writing fidelity
- **Depends on:** `plans/012-canonical-workspace-storage.md`
- **Category:** direction / application architecture
- **Planned at:** commit `133f8a6`, 2026-09-27
- **State:** TODO; planning approved, implementation unassigned

## Why this matters

Independent databases are useful only if links, forms, searches, browser state, and delayed generation results stay in the intended workspace. This plan makes the URL the explicit source of scope and gives the owner native create/list/rename/switch controls. It must not introduce an ambient active workspace that makes two tabs or a delayed request interfere.

Separate files still are not agent authorization. Plan 014 adds an owner/agent boundary before exposing memory tools; do not claim workspaces are protected from an unauthenticated local HTTP client at this intermediate checkpoint.

## Prerequisite contract — verify without relying on prior conversation

Plan 012 provides:

- `WORKSPACES_PATH` (default `.data/workspaces/`), `app.sqlite` for workspace catalog and persistent browser visitors, and one `<workspace-uuid>.sqlite` per workspace.
- A `WorkspaceStore` supporting create, bounded list, get/open, revision-checked rename, and explicit close. Server IDs determine paths; missing/foreign IDs never create/open another file. Each database's embedded UUID agrees with its catalog identity.
- Fresh object format 4; no legacy conversion/reset. All current objects, Markdown, revisions, receipts, references, views, conversations, and Journal rules remain intact.
- One Bun process, private files, prepared SQL, foreign keys, WAL, full synchronous durability, and a testable application/store shutdown path.
- New application workspaces get the existing transactional demo, without a provider call. Existing/emptied workspaces never reseed.
- A temporary unprefixed UI bound once to the first workspace. **This plan removes it**, not preserves it as a second live route family.

If those facts are not true, stop and reconcile the prerequisite first.

## Current-state anchors at the planning commit

- `src/objects/http.ts:80–99` constructs services against one runtime and assumes root-relative domain paths:

  ```ts
  export function createObjectRoutes(objects: ObjectRuntime, generator: ViewGenerator = generateView) {
    const views = new ViewService(objects);
    const conversations = new ViewConversationService(objects.db, views);
    const generating = new Set<string>();
  ```

  The request handler creates an `ObjectPageModel`, returns trusted JSX, and redirects with `Location: path`. Preserve the database-bound services and per-visitor in-flight generation guard.
- `src/server.ts:111–153` classifies body limits and JSON error responses by unprefixed paths. Prefixing only successful routes would break Unicode prompts, oversized-body handling, and JSON errors.
- `src/objects/render.tsx:15` has `const objectUrl = (id: string) => \`/objects/${encodeURIComponent(objectIdentity(id))}\`; navigation, form actions, reference links, history/conflict fragments, and view actions have other root-relative URLs.
- `src/objects/client.ts:40` stores assistant state under a CSRF-based key; lines 233/261/350 use `/views/conversations/...`, `/views/generate`, and `/objects/lookup`; lines 321/342 use the global `taskdesk:pinned-views` key. The Journal shortcut at line 661 also navigates to a root-relative domain path.
- `src/objects/writing-links.ts:9–12` currently serves both stored-link normalization and display navigation:

  ```ts
  export function writingHref(href: string): string {
    const target = objectLink.exec(href);
    return target ? `/objects/${target[1]!.toLowerCase()}` : href;
  }
  ```

  `src/objects/writing.ts:199,306–307,332` uses it for DOM anchors **and** ProseMirror mark attributes. Blindly adding the workspace prefix would rewrite saved Markdown and break backlink extraction.
- `src/objects/markdown.ts` extracts local references from `/objects/UUID`; `renderMarkdown` is used for current, historical, and comparison writing. `src/objects/demo.ts:18` intentionally creates these workspace-local stored links.
- `src/objects/ai-state.ts` makes submitted drafts and explicit conversation/refinement requests take precedence over stored state. Preserve this rule within each workspace.

### Conventions and preserved guarantees

Use Hono JSX, `src/objects/ui.tsx` buttons/links, existing semantic CSS roles, native forms, and small direct helpers. Do not introduce a router framework or use an HTML-wide string replacement to scope URLs. Object/type/property rules remain in existing domain commands.

Tests follow `node:test` / strict assertions. The exemplar in `test/objects-client-state.test.ts` tests exact draft precedence rather than snapshots:

```ts
assert.deepEqual(restoreAiState(request, thread, 'explicit'), request);
```

Markdown remains authoritative, 256 KiB UTF-8 at most. Loading or changing only properties preserves the original source. Failed writes retain drafts and their submitted revisions. Generated data remains declarative/untrusted, and the embedded Pi view generator remains metadata-only.

## Routing and state contract

| Surface | Canonical route / behavior |
| --- | --- |
| Application entry | `/` redirects to `/workspaces`; no global active-workspace selection |
| Workspace catalog | `GET /workspaces`, bounded listing with native links/forms |
| Create | CSRF-protected `POST /workspaces/create`; display name only; redirect to new workspace |
| Rename | CSRF-protected `POST /workspaces/:id/rename`; display name and expected revision |
| Workspace home | `/w/:workspaceId/` |
| Domain routes | `/w/:workspaceId/objects/...`, `/types/...`, `/properties/...`, `/views/...`, `/calendar`, `/tasks`, `/journal` |
| Assets | Existing fixed root-level CSS/JS routes; no workspace data in bundles |
| Old unqualified domain routes | 404; no first-workspace or cookie-based fallback |

The router validates the workspace ID and resolves the catalog entry once. Pass an immutable workspace ID/base path and that workspace's runtime to downstream work. A stripped local domain path is acceptable for matching existing routes, but generated URLs and external redirects must always include the explicit workspace prefix. Unknown/repeated fields cannot override this binding.

Keep browser visitor identity in the administrative database and successful view conversations in their originating workspace database. Conversation lookup must still match the visitor as well as the workspace.

## Commands you will need

| Purpose | Command | Expected result |
| --- | --- | --- |
| Dependencies, only if absent | `bun install --frozen-lockfile` | Exit 0; lockfile unchanged |
| Typecheck | `bun run check` | Exit 0 |
| New routing contracts | `bun test test/workspaces-http.test.ts test/workspaces-client.test.ts` | All pass after adding the files |
| Existing HTTP/state contracts | `bun test test/http.test.ts test/objects-http.test.ts test/objects-client-state.test.ts` | All pass |
| Writing fidelity | `bun test test/objects-markdown.test.ts test/objects-runtime.test.ts` | All pass |
| Full gate | `bun test` | All pass without provider calls |
| Hygiene | `git diff --check` | Exit 0 |

For browser work, read `/home/alex/.agents/skills/orca-cli/SKILL.md`, resolve the executable as it specifies, and load its version-matched guide before commands. Use **Orca's built-in browser only**. If unavailable or trusted keyboard events cannot be established, report the gate blocked; do not substitute Playwright, a separate browser, or jsdom.

## Scope

**Only these files may change:**

- `src/server.ts`, `src/workspaces.ts` for composition and request/lifecycle binding, not new storage semantics.
- `src/workspaces-http.ts`, `src/workspaces-render.tsx`, `src/objects/urls.ts` (new cohesive management/URL helpers).
- `src/objects/model.ts`, `http.ts`, `render.tsx`, `client.ts`, `ai-state.ts`, `writing.ts`, `writing-links.ts`, `markdown.ts`.
- `public/objects.css` for the workspace selector/management controls using existing tokens.
- `test/workspaces-http.test.ts`, `test/workspaces-client.test.ts` (new); `test/workspace-fixture.ts` if introduced by the prerequisite.
- `test/http.test.ts`, `test/objects-http.test.ts`, `test/objects-client-state.test.ts`, `test/objects-markdown.test.ts` for scope-aware expectations; retain their existing behavior assertions.
- `README.md`, `docs/object-contract.md`, `docs/quickstart.md`, relevant operational/project-map lines of `AGENTS.md`.
- This plan/index and a bounded browser evidence record under `plans/` if assigned.

**Out of scope:** database migrations; workspace deletion/archive/import; moving/cloning objects; shared types across files; per-object permissions; memory endpoints/tokens; owner authentication (Plan 014); a general navigation/state framework; new dependencies or CSS palette; changing view generation or Pi resource discovery; changing stored demo Markdown to prefixed URLs. Do not read or modify the owner's `.data/`.

## Git workflow

Use the local `orca-development` skill and the assigned Orca checkout, with one writer. Suggested branch if requested: `improve/013-workspace-ui`. No commit, merge, push, publication, or unrelated cleanup without separate authorization. Existing commits use short imperative subjects. Preserve predecessor changes and any owner edits.

## Steps

### 1. Verify the prerequisite and add explicit route context

Run the drift check and baseline. Define the minimal page/request workspace context in `src/objects/model.ts` and simple URL construction in `src/objects/urls.ts`. IDs come from validated server context, not a browser-stored workspace name or a process-global variable. Helpers should construct known local destinations and reject protocol-relative/foreign destinations when accepting a return path.

Update `src/server.ts` to dispatch fixed assets/management routes separately and resolve `/w/:id/...` once. Bind database services and their generation guards per workspace, not afresh in a way that resets the in-flight guard on every request. Fetch display metadata freshly enough that rename is visible without reopening the application. Do not cache a stale name as permanent routing identity.

Route-specific form limits, content types, origin/host/CSRF checks, failure formats, and redirects must use the correctly parsed local domain route. Unknown workspace requests return errors without creating/opening fallback databases. Remove the intermediate first-workspace route fallback.

**Verify:** `bun run check && bun test test/workspaces-http.test.ts test/http.test.ts` → canonical prefixes accepted, unqualified domain routes unavailable, wrong/missing IDs fail closed, assets unchanged, Unicode generation envelopes and secured JSON errors retained.

### 2. Add native workspace management and switching

Implement the management routes/rendering in the named files. Use the existing catalog/create/rename commands; validate only boundary shape in HTTP. Preserve submitted name/revision on rejection. Rename does not change workspace UUID, file, object IDs, view IDs, or stored Markdown. Root entry always shows the catalog, not an ambient last-used workspace.

Add a compact, clearly labeled current-workspace control in the existing shell. Prefer ordinary navigation links to a catalog and other workspace homes, or a native select with an explicit Go submit; never navigate on focus alone. Bound long catalogs using the store pagination rather than loading every workspace into every page. Controls work without JavaScript, use visible keyboard focus, and fit the mobile drawer.

Enhanced switching must participate in the existing unsaved-edit protection. Do not automatically save or discard object/property drafts. An unsent view prompt is persisted under the current workspace key before navigation; if storage is unavailable, show a clear unsaved-state warning rather than claiming it was preserved. No-JavaScript navigation cannot promise automatic draft retention; retain the existing explicit-save baseline and label that limitation honestly.

**Verify:** `bun test test/workspaces-http.test.ts test/objects-http.test.ts` → native create/rename/switch routes work; rejected drafts and stale rename revisions retained; rename leaves data and stable URLs unchanged. Browser checks in Step 6 prove focus/layout/dirty-navigation behavior.

### 3. Scope every rendered and enhanced domain URL

Update `src/objects/http.ts`, `render.tsx`, and `client.ts` together. Inventory form actions, hrefs, result URLs, history/recovery links, conflict comparison fragments, reference links, generated view links, conversation fetches, lookups, typed reference pickers, view actions/inputs, Journal Today/open, and retry/error navigation.

Use explicit context rather than scattered prefix concatenation or rewriting finished HTML. Assets stay root-level. There must be no unqualified object/view request sent by an enhanced page and no unqualified redirect from a scoped native form. Keep existing status codes and draft handling.

Resolve all domain IDs inside the selected runtime, including previous views, conversations, historical snapshots, and reference candidates. A valid UUID from another database is not a reason to search other workspaces. Equal built-in IDs in two workspaces have independent names/properties. Tests should also use deliberately equal object/view IDs in isolated fixtures to detect mistaken global ID-only caches.

**Verify:** `bun test test/workspaces-http.test.ts test/http.test.ts test/objects-http.test.ts` → two-workspace native/enhanced HTTP matrix passes, all response links/actions/redirects remain scoped, and wrong-workspace references/history/conversations fail without mutations. `rg -n '/objects/|/views/|/journal|/types|/properties' src/objects/client.ts src/objects/http.ts src/objects/render.tsx` → review every remaining literal: local route matching or explicit helper input is acceptable; unscoped browser navigation is not.

### 4. Separate stored Markdown identity from displayed destinations

Keep `/objects/UUID` as the canonical **stored workspace-local** link syntax and keep `markdownReferences()` independent of request context. Preserve case-insensitive UUID behavior. Do not rewrite saved bodies, histories, creation receipts, demo links, or ProseMirror mark attributes to `/w/...`.

In `writing-links.ts`, distinguish canonical source-link normalization from resolving a safe display destination using the explicit workspace ID. Update `renderMarkdown(body, workspaceContext)` and every renderer callsite, including history, recovery, saved readers, and conflict comparisons.

In `writing.ts`, use the display resolver for DOM `href` only; editor marks/serialization retain canonical `/objects/UUID`. In `client.ts`, a search result **navigates** to a prefixed object URL but **inserts** an unprefixed canonical writing link. External http/https/mailto behavior stays unchanged. Do not broaden the safe-link allowlist to arbitrary root-relative URLs or treat an absolute web link as an automatic cross-workspace reference. Images/raw HTML stay inert.

**Verify:** `bun test test/objects-markdown.test.ts test/workspaces-http.test.ts test/objects-http.test.ts test/objects-runtime.test.ts` → one identical Markdown source renders different workspace-local destinations in A/B; exact bodies and receipts do not change; history/comparison links use their originating workspace; unsafe links/images remain inert. Browser Step 6 verifies formatted insertion, property-only save, undo, and native fallback.

### 5. Isolate browser state and delayed work

Namespace assistant drafts/thread pointers by both workspace UUID and existing visitor/CSRF identity. Namespace pins by workspace UUID. Presentation-only panel width may remain application-wide; do not multiply non-content preferences without need. Do not import old unscoped content-bearing keys into an arbitrary workspace.

Preserve `restoreAiState`'s submitted/explicit/browse precedence. Add a small testable workspace-key/binding helper only if necessary; avoid a new state framework. A malformed or mismatched saved record must not restore another workspace's thread, target, or draft.

Bind each asynchronous generation/search request to its original immutable workspace context. A completion can update only its originating tab/page state and must return a URL for that workspace. Switching/navigating or opening B while A is generating must not write into B, render A's results in B, or retarget the persisted conversation. Preserve the existing safeguard against navigating away from dirty forms when generation finishes. Keep a rejected/native prompt's exact bytes, including whitespace.

**Verify:** `bun test test/workspaces-client.test.ts test/objects-client-state.test.ts test/workspaces-http.test.ts` → scoped storage keys and precedence pass; controlled deferred generators prove A/B concurrency stays bound and failed generation leaves both object stores unchanged. These injected generators do not prove real provider behavior.

### 6. Exercise the actual browser flow and update docs

Launch only a disposable root, for example after creating it with `mktemp -d`:

```sh
WORKSPACES_PATH=/absolute/temporary/taskdesk-workspaces PORT=3107 bun start
```

The path above is a placeholder, not a command to run unchanged. Do not use the default root or perform paid generation. A test fixture server with a deterministic/deferred injected generator is appropriate for UI scope tests. Clean up only resources you created, after closing server/database handles.

Using Orca's built-in browser, record the following with actual assertions and desktop/narrow screenshots where applicable:

1. Create A/B, rename A, switch using keyboard and native controls; no URL loses its workspace prefix.
2. With JavaScript disabled, create/edit objects, submit a rejected form, open history, and use a view action in each workspace. Draft fields and revisions survive rejection.
3. Two tabs share the owner browser identity but keep different workspace drafts, pins, searches, and conversation targets. Switch away/back to an unsent prompt and recover that workspace's prompt only.
4. Edit title and formatted writing, attempt a workspace switch, cancel navigation, and confirm content/selection remain; also exercise fallback Markdown editing and a storage-unavailable warning.
5. Insert a local object link, save, follow it, reopen history/compare writing, and confirm the stored source still uses `/objects/UUID`. A title/property-only save must preserve original source, and undoing writing edits back to the original document must preserve it as before.
6. Start a controlled delayed view generation in A; browse B in another tab and, separately, navigate the originating tab. Completion must remain in A, and dirty A edits must not be replaced by automatic navigation. Rejected explicit refinement stays explicitly targeted.
7. At desktop and approximately 390px width, the workspace control and drawers remain readable, keyboard reachable, visibly focused, and free of new horizontal overflow. Establish trusted focus/key events before claiming keyboard success.

Document workspace scope, local Markdown links, new canonical URLs, state separation, fresh-format/no-migration boundaries, and the distinction between visitor continuity and the upcoming agent authorization. Remove instructions to create another workspace using `DATABASE_PATH`. Preserve the Orca-only policy in `AGENTS.md`.

**Verify:** `bun run check && bun test && git diff --check` → exit 0. Browser evidence must identify the exact fixture, commands/actions, observed outcomes, screenshots, and any blocked cases; absence of real browser evidence blocks UI acceptance even when tests pass.

## Test plan

Add `test/workspaces-http.test.ts` for real HTTP over two isolated temporary files and `test/workspaces-client.test.ts` for bounded pure state/URL tests. Follow existing strict-assert and cleanup patterns; avoid exact whole-page snapshots or tests that merely duplicate constants.

Required regressions: unknown workspace cannot create a file; wrong database IDs cannot read/write data; duplicate fixture IDs never consult a global cache; renamed workspaces preserve links; body bounds and JSON error handling survive prefixes; native draft/history/view-command protections remain; scoped conversation ownership and delayed-generation writes remain atomic; raw canonical writing links survive all relevant rendering/editing paths; storage failure cannot falsely report preserved drafts.

## Done criteria

- [ ] `bun run check`, `bun test`, and `git diff --check` pass.
- [ ] New two-workspace HTTP/state tests pass with independently persisted files and deferred generation.
- [ ] Native links/forms and all enhanced requests/redirects use explicit scope; legacy domain routes have no fallback.
- [ ] Current/history/compare/editor link tests prove display scoping without stored Markdown rewriting.
- [ ] Actual Orca browser checks above pass, or the plan remains explicitly BLOCKED for any unverified UI gate.
- [ ] Docs and `git status --short` match the scope; no real user-data/provider access or unassigned publication occurred.
- [ ] The assigned index owner records the actual result and distinguishes HTTP assertions from browser verification.

## STOP conditions

- The prerequisite storage/identity/lifecycle contract is missing or has materially changed.
- Fixing scope requires a mutable global active workspace, a cookie-based implicit fallback, cross-file queries, or a broad router/state framework.
- A proposed link fix changes saved Markdown merely on loading, property edits, or display; or requires accepting arbitrary relative URLs.
- The implementation would discard unsaved content, silently advance a revision, rebind an in-flight request to another workspace, or weaken conversation ownership.
- An unlisted source file or a database/schema redesign is needed; report the specific reason before broadening scope.
- A gate fails twice after a reasonable targeted repair, or Orca browser verification cannot establish trusted interaction. Preserve evidence; do not mask the blocker.

## Maintenance notes

Workspace UUID plus local object/view/conversation ID is the full application identity; built-in UUIDs intentionally repeat between databases. New routes, local-storage keys, async callbacks, writing renderers, and error branches must carry explicit context. Plan 014 may add authentication but must not turn browser visitor cookies into agent grants or give the existing view generator object-reading tools.
