# Plan 021: Avoid loading HTML presentation data for requests that do not render it

## Status
- Priority: P1; effort: S–M; risk: LOW–MED; category: perf.
- Planned at: `eb324c4e05ed73243dabc6242422baea4e855c67`, 2026-09-27.
- Depends on: none. One executor may implement plans 021–024 sequentially in one isolated checkout; reviewer owns the index.
- User authorized implementation of the first four architecture-audit recommendations. No schema migration, caching rollout, merge, push, or live-data access.

## Drift check
Run `git diff --stat eb324c4..HEAD -- src/objects/http.ts test/objects-http.test.ts test/http.test.ts docs/object-contract.md`. Reconcile changes against the excerpts before proceeding. Changes from the same authorized 021–024 series are expected; unrelated drift requires STOP.

## Why
`createObjectRoutes` currently loads all saved views, including full specs and prompts, on every recognized request. JSON lookup and successful POST redirects do not need them. A real local HTTP probe of the unchanged 50-result lookup measured 0.27 ms with no saved views and 14.46 ms with 1,000 synthetic views; response bytes stayed identical. These are synthetic warm medians, not guaranteed real-user gains. Also, lookup calls getType once per result even though the route already loaded the catalog.

## Current state and conventions
- `src/objects/http.ts:89–95`:
  ```ts
  const catalog = objects.catalog();
  const model: ObjectPageModel = {
    csrf: visitor.csrf, path: url.pathname, screen: 'objects', catalog, views: views.list(), objects: [],
    aiOpen: url.searchParams.get('ai') === '1',
    ...(url.searchParams.has('saved') ? { notice: 'Saved.' } : {}),
  };
  const page = (status = 200) => new Response(renderObjectWorkspace(model), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  ```
- Lookup maps records with `typeName: objects.getType(record.typeId).name` at line 241.
- `ViewService.list()` executes `SELECT * FROM object_views WHERE deleted = 0 ORDER BY updated_at DESC, id ASC` and parses each spec.
- HTTP routes populate mutable request-local `model` data and call `page()` only for HTML; success commands return `go()` redirects or JSON. Preserve this straightforward pattern instead of introducing a routing framework, lazy-object proxies, caches, or dependency injection.
- `test/objects-http.test.ts` uses node:test, node:assert/strict, in-memory ObjectRuntime, an injected provider-free generator, and a local server that is closed by test cleanup. Match those conventions.
- The model is declarative data; only trusted JSX renders HTML. Native rejected writes retain drafts and expected revisions. Explicit AI context takes precedence over tab state. Visitor-owned conversation access checks must remain unchanged.

## Scope
Only modify `src/objects/http.ts`, `test/objects-http.test.ts`, `test/http.test.ts`, and a focused factual update to `docs/object-contract.md`. Do not modify render.tsx, client.ts, server.ts, schema/model contracts, dependencies, plans 012/013, or another worktree. Broader view-summary models and view-list pagination are deferred; they are not needed to stop loading unused views.

## Steps
1. Inspect GET/POST/error paths and add a regression demonstrating unused views are loaded for lookup/conversation JSON and successful mutation redirects. Instrument the existing service/database narrowly within a test with guaranteed restoration, not a production test seam. Assert real response contents/status/security too. Verify `bun test test/objects-http.test.ts test/http.test.ts` reproduces the intended regression before fixing.
2. Make saved-view loading occur at HTML rendering time, once per request. Keep all HTML navigation, view lists, calendar cards, counts, native error pages and assistant context populated. Keep failures explicit. Do not construct an alternate domain write path. Avoid fetching catalogs on JSON-only endpoints if a direct, simpler route placement allows it, but removing the proven full-view load is the required outcome; do not contort the handler to save two small metadata queries. Verify focused tests pass.
3. Reuse a request-local catalog map (or equivalently bounded type lookup) for lookup type names rather than querying per row. Preserve type validation, missing/wrong type errors, exact response shape, literal search, lookahead, trash scope, no-store and ownership boundaries. Verify focused tests pass.
4. Add tests that HTML paths still show saved views and retain rejected drafts, while successful redirects/JSON avoid full-view listing. Re-run `bun run check`, `bun test`, `git diff --check`; all must exit 0. Add only a concise accurate contract note, not an unmeasured speed promise.

## Done criteria
- Existing HTTP and domain tests pass; full suite remains provider/network independent.
- GET lookup with many saved views returns the same bounded objects and names without invoking the saved-view listing path or one SQL type query per returned row.
- Conversation JSON preserves visitor ownership and error statuses without loading HTML-only views.
- A representative successful native mutation returns its redirect without listing saved views; a rejected form still renders correct navigation and retained input.
- HTML view lists/calendar/navigation retain all current behavior; no silent pagination or omitted pins.
- `bun run check`, `bun test`, and `git diff --check` pass.

## Commands and workflow
Bun 1.4.2+, existing lockfile. If needed, `bun install --frozen-lockfile`; never npm install. Use the assigned isolated Orca worktree because the main checkout runs the user's live watch server. Commit a logical implementation/test unit with a descriptive message (e.g. `Avoid eager saved-view reads for JSON and redirect responses`). Do not merge, push, reset or touch `.data`. Reviewer, not executor, updates plans/README.md.

## STOP / maintenance
Stop if the change requires new UI behavior, schema changes, loss of error draft context, another writer's files, a real model call, or out-of-scope edits. Ask the coordinator rather than adding generic abstractions. If verification fails twice after reasonable repairs, report the failure. Browser tests are not required for unchanged HTML/interaction contracts; if UI changes become necessary, stop for scope review and use Orca only. Future HTML rendering must still populate shell data before calling trusted renderObjectWorkspace.
