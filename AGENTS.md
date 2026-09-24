# Agent instructions

## Priorities

Taskdesk is an early-stage, local, single-owner object workspace. Optimize for a small, understandable codebase, not a general-purpose application platform.

- **KISS:** choose the simplest complete solution to the current problem. Simplicity means fewer concepts and clearer control flow, not fewer lines.
- **YAGNI:** implement demonstrated needs only. Do not add speculative extension points, configuration, services, plugins, or compatibility layers.
- **Pareto:** find the smallest scope that delivers most of the user value. Offer a simpler alternative when a feature introduces disproportionate complexity; agree on reduced scope before implementing it.
- Prefer removing unnecessary behavior to building abstractions around it. The object workspace is canonical; do not reintroduce the removed issue experiment, vault tooling, or legacy migration paths.
- Correctness, data preservation, security, and accessibility are not the expendable 20%. Never simplify by weakening those guarantees.

Before a nontrivial change, state briefly: the user outcome, the smallest complete approach, what is intentionally out of scope, and how it will be verified. Ask about material product tradeoffs, not details the code can answer.

## Project map

Read `README.md` for setup and current boundaries. Read `docs/object-contract.md` when changing object, view, query, or persistence behavior. `docs/quickstart.md` documents usage and backups.

- `src/server.ts`: Bun HTTP entrypoint, shared request security, assets, and route composition.
- `src/visitors.ts`: persistent browser identity and CSRF state, separate from shared object data.
- `src/database.ts`: SQLite connection setup and durability.
- `src/objects/model.ts`: active object/view types and declarative schemas.
- `src/objects/runtime.ts`: canonical object/type/property commands, revisions, and backlinks.
- `src/objects/views.ts`: view validation, lifecycle, bounded SQL queries, and scoped commands.
- `src/objects/conversations.ts`, `generator.ts`: view conversations and isolated Pi generation.
- `src/objects/markdown.ts`, `values.ts`: bounded Markdown writing and scalar/temporal validation.
- `src/objects/upgrade-markdown.ts`: one-time transactional upgrade of the current object writing format.
- `src/objects/http.ts`, `render.tsx`, `client.ts`, `public/objects.css`: HTTP parsing, trusted rendering, browser enhancement, and styling.
- `src/pi.ts`: resource isolation for the embedded view generator.
- `test/objects-*.test.ts`, `test/http.test.ts`, `test/pi.test.ts`: domain, HTTP/security, and model-isolation contracts.

## Architecture and implementation

- Keep the current one-process Bun + SQLite architecture, strict TypeScript, Hono JSX rendering, and native browser APIs unless a concrete requirement justifies changing them.
- Prefer Bun's built-in server, SQLite, bundler, Markdown, HTMLRewriter, file, cookie, hashing, and test APIs where they reduce code or dependencies. Do not replace a maintained library with a custom adapter merely to use more Bun APIs.
- Writing is Markdown-first: store the submitted source and use a native textarea. Do not reintroduce rich-text editor dependencies or an editor-specific JSON authority. Use the shared safe Markdown renderer, never raw user HTML; saved reading is not an unsaved live preview.
- Keep HTTP input parsing at the boundary, domain rules in the existing runtime/services, and rendering separate from mutations. Native forms, browser enhancements, and view actions must use the same domain commands.
- Use `src/objects/model.ts` as the active schema/type authority. Reuse existing validation rather than inventing another representation or duplicating business rules in the browser.
- Keep submitted drafts separate from saved records: rejected writes must retain user input without bypassing revision checks. Explicit request context takes precedence over stored browser state; derive display values instead of maintaining competing copies.
- Prefer ordinary functions and direct calls. Extract a helper when it captures a coherent rule or removes meaningful repeated logic; a small amount of duplication is better than an abstraction with unrelated flags and exceptions.
- Split files by cohesive responsibility when that makes changes easier to reason about, not to meet arbitrary line-count limits. Do not replace a long file with a maze of tiny wrappers.
- Write readable multi-line control flow and JSX. Avoid compressed multi-action statements and nested ternaries for business decisions.
- Avoid generic repositories, dependency-injection frameworks, event buses, plugin registries, extra network services, and framework rewrites without a demonstrated need.
- Add dependencies only when they remove more complexity than they introduce; use the existing stack first. Do not build custom replacements for established editor or parsing libraries just to lower dependency count.
- Keep changes focused. No unrelated renames, formatting sweeps, dependency upgrades, or speculative optimization. Measure before adding caches or performance infrastructure.
- Inspect callsites before changing a shared contract. For an agreed replacement, update callers, tests, and documentation together rather than retaining duplicate live paths.

## Non-negotiable boundaries

- SQLite is the sole live authority. Objects own data; views reference it. Deleting or refining a view must not delete, copy, or silently mutate objects.
- Preserve stable identities, revision conflict checks, creation idempotency, transactional revision/backlink updates, and atomic draft/conversation writes.
- Model output is untrusted declarative data. Validate it before persistence and render only trusted components. Never execute generated HTML, JavaScript, SQL, or arbitrary tools.
- Preserve existing canonical data and fail on unsupported database schema versions. Current-format upgrades must be transactional and fail rather than drop unrecognized content. Do not reintroduce historical issue/vault conversion or delete unrelated tables/files on startup.
- View generation receives the intended schema metadata and user-supplied prompt context, not automatic access to object contents, files, shell, personal agent instructions, or extensions. This file governs repository development, not the embedded model's resource discovery.
- Keep generation bounded and failures explicit. Do not fabricate fallback views or success. Structural view compatibility does not grant write permission; commands must check their current publication, capability, revision, and scope.
- Keep loopback binding, host/origin/CSRF protections, safe document links, prepared SQL values, and input/query bounds. Visitor cookies isolate conversations, not access to shared objects; this is not a multi-user authentication system.
- Native server-rendered forms remain functional without JavaScript. Enhancements must preserve unsaved edits, explicit AI conversation targeting, keyboard access, and focus behavior.

## Verification and safe working

Use Bun 1.4.2+ and the checked-in lockfile. Existing commands:

```sh
bun install --frozen-lockfile  # Only when dependency installation is needed.
bun run check                # Strict TypeScript check.
bun test test/objects-runtime.test.ts  # Example focused test file.
bun test                     # Full local suite.
bun start                    # Local server; defaults to the real .data database.
```

- Use `openDatabase()` for in-memory tests or an explicitly temporary `DATABASE_PATH` for smoke servers. Do not reset data or experiment against the user's `.data/` directory. Never delete it to make a test pass.
- Follow existing `node:test` and `node:assert/strict` conventions, executed through `bun test`. Keep fixtures isolated and close servers/databases and remove temporary artifacts.
- For a bug fix, reproduce the behavior and verify the fix. Keep regression tests for plausible failures: lost edits, stale revisions, rejected writes, persistence failures, scope violations, and other observable contracts.
- For changed features, exercise the actual path. Add permanent tests for meaningful behavior or uncertain edge cases, not line coverage, implementation details, copied values, or exact markup snapshots.
- UI changes need browser verification of the affected flow, including keyboard/responsive behavior where relevant. HTTP assertions and jsdom do not prove layout or focus works in a real browser.
- Run focused checks while working; run `bun run check` and `bun test` before handing off code changes. For documentation-only work, verify commands, paths, and claims instead of adding tests.
- Do not run paid/provider calls by default or claim injected generators verify real model integration. Normal tests must not require Pi credentials or network access.
- Report exactly what was exercised, what passed, and what could not be verified. Do not mask failures with catches, disabled checks, or fake fallbacks.
- Update existing docs when behavior changes. Keep this file short and operational; do not turn it into a roadmap or duplicate the detailed product contract.

## Scope check before delivery

Does this solve the requested problem completely? Is there a simpler approach with the same outcome? Did it introduce concepts or options without a current user need? Are data and trust boundaries intact? Is verification proportional to the actual risk?

If simplicity and optional feature breadth conflict, prefer simplicity and discuss narrowing the feature. Do not silently narrow an agreed requirement.
