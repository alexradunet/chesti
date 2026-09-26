# Implementation plans

## Taskdesk reliability audit — 2026-09-26

Audited at `438d497`, standard hotspot-weighted scope. User authorized automatic selection and Orca implementation; selected five confirmed bugs grouped into three bounded plans. Baseline: Bun 1.4.2, TypeScript and 64 tests passed. Earlier tooling plans below are historical and unchanged.

| Plan | Outcome | Priority / effort / risk | Status |
| --- | --- | --- | --- |
| [004](004-safe-emphasis-upgrade.md) | Faithful version-1 emphasis upgrade | P1 / M / MED | DONE — reviewed; migration/rollback tests pass |
| [005](005-bounded-http-inputs.md) | Per-target reference picker bounds; accepted Unicode prompt envelope | P1 / M / LOW–MED | DONE — reviewed; HTTP/browser flow passed; keyboard/responsive picker checks unverified |
| [006](006-assistant-intent-and-modal-focus.md) | Explicit AI targeting; native modal keyboard ownership | P2 / S–M / LOW–MED | DONE — code reviewed; targeting passed; real keyboard/selection acceptance remains unverified |

Reviewed result: **`improve-ui-intent`** at **`125f712cf6611694efc988d64748a7aaad3c86cc`**, with 13 scoped paths changed and no dependency/schema redesign. All seven audit/implementation/integration workers completed and were released; review inbox empty. Run: `run_da3e6d098bd2`.

Current delivery: the user subsequently authorized committing the requested untracked files and publishing to the existing **`master`** branch (no `main` branch creation or default-branch change). The publication executor fetched origin, verified local and remote `master` at `438d497` and the reviewed worktree clean, then fast-forwarded `master` to `125f712`. Bun 1.4.2 strict TypeScript, all **75 tests** (0 failures), and baseline diff hygiene passed again in the original checkout. The 108 eligible files under `.agents/`, `plans/`, and `skills-lock.json` were reviewed for sensitive material; no credentials or unrelated private content were found. Ignored evidence logs remain unstaged. This record is prepared before the authorized normal push; the completion report records its actual result and final remote hash. See [execution and verification record](004-006-execution.md), especially the unchanged keyboard verification limitation.

### Vetted findings (highest leverage first)
| Finding | Category | Impact | Effort / risk | Evidence |
| --- | --- | --- | --- | --- |
| Unicode prompt envelope | Bug | Valid 4,000-character CJK prompts rejected before draft-aware validation | S / LOW | `src/server.ts:115`, `src/objects/http.ts:285` |
| Punctuation emphasis upgrade | Data preservation | Current/history writing gains literal delimiters and loses formatting | M / MED | `src/objects/upgrade-markdown.ts:103–106,167–172,219–261` |
| Typed reference candidates | Bug | Unrelated objects crowd valid targets out of bounded pickers | M / LOW | `src/objects/http.ts:82,158,172`, `src/objects/render.tsx:94` |
| Explicit assistant refinement | Bug | Stored conversation overrides directly requested view | S / LOW–MED | `src/objects/client.ts:47–59`, `src/objects/render.tsx:488` |
| Link dialog Escape | Accessibility | Background assistant consumes foreground modal dismissal | S / LOW | `src/objects/client.ts:207–209`, `src/objects/writing.ts:279,292–297` |

All five HIGH confidence, with cited code independently opened by lead; auditors reproduced defects through in-memory HTTP/migration or extracted control flow. Executors must retain regression tests and browser-check UI paths.

### Deferred / considered and rejected
- Generator lifecycle/concurrency test matrix: real coverage gap (`generator.ts:26,81,101,108`), but not an observed runtime bug; defer broad SDK-mocking work from this bounded fix pass.
- Formatted-writing browser regression suite: real coverage gap; verify affected dialogs now, defer a new whole-editor test infrastructure and dependency.
- File-size refactors, generic picker/state frameworks, dependency churn and new product features: not justified for this local early-stage workspace.
- Multi-user authentication, notifications, plugins, sync and historical issue/vault migrations: intentionally out of scope by product contract, not findings.

### Audit limits and direction
Reviewed core domain/persistence, request boundaries, UI state/writing, tests, docs and manifest. Not a whole-repository security certification: no network dependency advisory audit, live provider integration, real user database inspection, or exhaustive browser/editor matrix. No new product features proposed: improve documented existing workflows first. No source/credential values copied into plans.


Prepared against Taskdesk `2403c1a`. Active guidance is the standalone local `~/.agents/skills/orca-development/SKILL.md`, plus a short Taskdesk `AGENTS.md` pointer. The separate pi-orca repository is archived, not a maintained package. Taskdesk application source, data and embedded model resource isolation are unchanged.

## Current direction

Give the lead capable tools and a short process, not a second orchestration framework. Orca owns worktrees, terminals, Tasks, Dispatches, messaging and lifecycle. The lead chooses decomposition, tools, concurrency and review depth within the owner's scope/budget.

| Plan | Status |
| --- | --- |
| [003: Local skill and repository retirement](003-local-orca-skill.md) | DONE — local skill automatically discovered by Pi; project pointer added; public repository archived at `6830466`. No package installation required. |
| [002: Skills-first native Orca](002-skills-first-orca.md) | SUPERSEDED as a package-maintenance plan. Partial native evidence preserved; old-package removal remains deferred, not bundled with Plan 003. |
| [001: Custom bridge](001-pi-orca-bridge.md) | SUPERSEDED — historical design and [execution evidence](001-execution.md), not the current acceptance matrix. Bridge source/tests remain in Git history at `8d98328`. |

## Boundaries

- One writer per checkout; exact Task/Dispatch identities; bounded assignments and no recursive or blind retries.
- Worker completion is evidence, not acceptance. Preserve failed edits and account for the whole FIFO Delivery before acknowledgement.
- Use native Orca cleanup and preserve unrelated/user-owned terminals and worktrees.
- Improve is advisory/read-only; assigned executors implement, integrate and publish. This does not make ordinary development leads universally read-only.
- Public tooling retirement/archive is complete. `pi-subagents`, `pi-intercom`, and unrelated `pi-web-access` remain installed; no package removal was included in the local-skill/archive approval.
- Do not claim native idle notification, custom bridge success, or package replacement from mocked tests or raw-CLI bypasses.

## Verification checkpoints

- Old bridge: provider-free TypeScript check and 24 tests passed. Custom live trial failed to establish replacement acceptance. Its historical tests are not relevant to a package that now has no runtime source.
- Skills-only package: real YAML parse, manifest/resource paths and diff hygiene passed after fixing an invalid description scalar. Final local and remote main verified at `cdc68142fde64bc35da0faa26ada073452ac1acc`; checkout clean.
- Scoped fixture: committed project filters exclude only old coordination resources; narrow trust added only for `/home/alex/orca/workspaces/pi-orca-smoke-WExO6Nvw`. No global package settings were changed.
- Native test: lead tool-name list excluded old coordination tools; exactly two normal supervised Pi launches returned ready. Lead ended its turn at 13:13:13 and did not receive an automatic mailbox wake before the explicit parent continuation at 13:20:32. Same workers then completed the exact Beta reply and deliberate-failure flow; this manual prompt is not a native wake pass.
- Native A/B and source integration terminals exited with captured archives, but their runtime release state remains unknown (`tab_not_found`). Worktrees/commits preserved; no broad closure. Final docs executor released normally; outer inbox empty. No executor assignment remains active.
- Taskdesk baseline: strict TypeScript and 64 tests passed before tooling implementation; application source/data unchanged.

Current receipts are under `plans/evidence/skills-*` and `fixture-trust-*`. See Plan 002 for remaining decisions, rollback scope and precise executor identities.
