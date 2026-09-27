# Implementation plans

## Current assignment — architecture hot paths, 2026-09-27

The owner requested **“implement them”** after the architecture audit's recommendation to implement its first four improvements. Scope is lazy request data, body-free reference validation, target-first reference membership, and reuse of unchanged writing derivations. Baseline is `eb324c4`: Bun 1.4.2 / SQLite 3.53.2, strict TypeScript and 128 passing tests. No source/data edits occurred during research. Existing untracked owner plans 012/013 remain untouched.

**Latest owner direction: “yes and push”, explicitly approving merge into `master`.** [Publication procedure](021-024-publication.md) authorizes a separate Pi executor to fast-forward main to accepted `c737ec8`, rerun checks, commit only this work's nine allowlisted planning/review records, and normally push to `origin/master`. The owner was told that updating main may restart the live watch server; no direct live-data/server access is permitted. This paragraph is a pre-publication authorization record, not a claim of success: the executor report and independently verified remote ref establish completion.

| Plan | Outcome | Effort / risk | Dependencies | Status |
| --- | --- | --- | --- | --- |
| [021](021-lazy-request-data.md) | Skip saved-view presentation reads for JSON and successful redirects; reuse type metadata | S–M / LOW–MED | — | DONE — accepted isolated `c737ec8` |
| [022](022-lightweight-reference-validation.md) | Use target summaries without reading target Markdown | S / LOW | — | DONE — accepted isolated `c737ec8` |
| [023](023-target-first-reference-queries.md) | Use existing target edge index for multiple-reference membership; preserve shared command scope | M / MED | — | DONE — accepted isolated `c737ec8` |
| [024](024-reuse-unchanged-writing.md) | Reuse transaction-local Markdown results and retain unchanged writing derivatives | M / MED | — (recommended after 022) | DONE — accepted isolated `c737ec8` |

**Accepted:** one Pi executor implemented the four plans in isolated top-level worktree `/home/alex/orca/workspaces/GenUIExperiment/architecture-hot-paths`, branch `alexradunet/architecture-hot-paths`, final `c737ec82e357c09a019e21174c257cf0d432e9f2`. [Final independent review](021-024-accepted-review.md): strict TypeScript, 134 tests, diff hygiene, default benchmarks and direct read/parse-count probes pass. One bounded verification repair; no demonstrated source defect. [Execution record](021-024-execution.md): Run `run_6421011b6463`, implementation Task `task_be259898f62f` and review Task `task_1adcf0f2bd77` are completed; all Deliveries acknowledged. Native release metadata remains `release_unknown/tab_not_found` after prescribed retry, but exact inspection confirms the worker terminal exited; output, worktree and commits are preserved. Isolation is required because the main checkout runs the owner's `bun --watch` server against the live database; editing there would restart it. Orca's configured `npm install` hook is skipped in favor of `bun install --frozen-lockfile`. The advisor edits plans only and never commits, merges or pushes the owner's branch. The initial implementation authorization excluded integration/publication; the later explicit owner permission above now authorizes only the reviewed fast-forward, allowlisted record commit and normal push. No schema migrations, new indexes, static-asset caching, FTS, JSONB, workspace redesign, provider calls, or `.data` access. Normal gates: focused tests, `bun run check`, `bun test`, `git diff --check`, and owned synthetic benchmark evidence; unchanged UI contracts need no speculative UI edits.

Research considered and deferred: asset caching is a separate follow-up; expression indexes require a demonstrated hot property; history normalization/deduplication is a larger preservation-sensitive migration; controlled WITHOUT ROWID reference-table experiment saved only ~14%; FTS helped rare terms but substantially slowed common bounded queries. No global caches, EAV rewrite, extra services, or weakened durability.

---

## Current assignment — six SQLite priorities, 2026-09-27

The owner requested plans for all six research priorities and implementation through subagents. The initial authority covered **isolated Pi implementation, review and a combined review branch**, not merge/push or `.data/` access. Baseline `133f8a6`: Bun 1.4.2, strict TypeScript and **91 tests / 0 failures**, diff hygiene passed again for this assignment.

**Latest owner direction: “let's commit and push.”** [Publication procedure](015-020-publication.md) authorizes a separate Pi executor to commit these SQLite records on top of reviewed `cc46cae` and normally push to the existing `origin/master`. A new isolated child avoids restarting the owner's live watch server in the original checkout or taking over the reviewed checkout's user-owned terminal. Original local `master`, pending plan copies and owner drafts 012/013 remain untouched; updating that live checkout is separate. The advisor writes plans/reviews only. This record is prepared before the push: the final executor report and remote-ref verification establish the actual publication result.

| Plan | Research priority / outcome | Dependencies | Status |
| --- | --- | --- | --- |
| [015](015-lightweight-object-queries.md) | 1 — direct typed predicates, lightweight reads, bounded backlinks | — | DONE for authorized integration — `209c256` reviewed; native-dialog check remains open by owner approval |
| [016](016-sqlite-connection-hardening.md) | 2 — trusted schema OFF, post-initialization planner maintenance | — | DONE — reviewed `e49eaf8`; lead TS/97 tests/hygiene pass |
| [017](017-evaluate-sqlite-runtime.md) | 3 — inspect/evaluate actual embedded runtime; update only if verified | — | DONE — reviewed `cc693c0`; latest stable Bun also embeds 3.53.2, so no upgrade claimed |
| [018](018-canonical-schema-invariants.md) | 4 — one current schema owner, data-preserving simple invariants | 016 | DONE — reviewed `680e7ce`; TS/102 tests/direct revision and version probes pass |
| [019](019-storage-and-backup-verification.md) | 5 — synthetic dbstat measurements and live-WAL snapshot restoration | — | DONE — reviewed `0ed4376`; TS/98 tests/diagnostics/fail-closed restore probes pass |
| [020](020-sqlite-query-experiments.md) | 6 — property-index, reference-edge and literal-search experiments | 015, 016, 018, 019 combined | DONE — [reviewed `cc46cae`](020-accepted-review.md); TS/128 tests, default/matrix/max-sample diagnostics pass; production adoption deferred |

[Execution/review record](015-020-execution.md), Run `run_6bb039a2b387`. **All six priorities are reviewed on isolated branch `alexradunet/sqlite-reviewed-integration` at `cc46cae2bfb8eadb46ec70e49e5c3c238f3040d7`.** Lead independently passed strict TypeScript, 128 tests, focused regressions, all benchmark variants, runtime/storage commands, scope/hygiene and clean status. Production src is unchanged from approved integration `9282c6d`; the additional owner-authorized benchmark repair closes the blocked `8e61f6a` findings with comparable savepoint writes, real setup/build/storage accounting, cleanup and substantive semantic tests.

Native unsaved-edit-dialog cancellation remains **unverified**, under the owner's explicit continuation approval; keyboard paging and responsive visuals were verified. Both owner gates `gate_2613561975cf` and `gate_63220a55eeb3` are resolved without claiming that UI check passed. The new publication authority does not authorize a third UI repair or production candidate adoption. Original local master remains `133f8a6` to preserve the running application. All implementation/review dispatches are settled and deliveries acknowledged; Orca retains the final terminal as `user_owned/user_takeover`, so it was deliberately left untouched. Earlier exited-worker release metadata anomalies remain recorded.

Execution uses explicit Orca Tasks/Dispatches, one writer per isolated checkout, bounded waits and release of settled workers. Query/schema changes overlap core files; isolated branches prevent collision. The configured `npm install` hook is skipped in favor of `bun install --frozen-lockfile`. No real application provider calls, global runtime installation, dependency churn, JSONB conversion or production FTS/index rollout. Benchmark results may justify a later separately scoped change, not automatic adoption. Browser changes use Orca's embedded browser only; unverified interaction/layout is a blocker, not a pass.

**Workspace-plan coordination:** owner plans 012/013 remain unmodified and unimplemented; 014 is reserved by their references for the future access boundary. These six plans therefore start at 015. Plan 018 reuses the intended `src/schema.ts` location but preserves current data and supported upgrades. Its current single-workspace version 4 supersedes the *unimplemented* workspace plan's proposed version-4 allocation: before executing Plan 012 later, reconcile it to a distinct fresh format/version and current initialization, never treat preserving version 4 as a workspace database or silently reset it. This is a drift notice, not authorization to execute workspace redesign or remove current upgrade support.

Verification: each executor runs focused regressions, strict TS, full suite and diff hygiene; lead reads full diffs and reruns gates. Combined branch verification follows integration by a separate executor. Publication uses an isolated child; the owner's original source branch stays unchanged. Runtime evaluation may honestly conclude no suitable update is available; optional upgrade failure must not be disguised as a successful upgrade.

---

## Earlier owner direction — publication before remaining browser verification

The owner explicitly requested **“push everything to main and then continue with browser verification.”** Publication of the reviewed `1796ccf` stack and all current planning records is now authorized before final UI acceptance. The existing default branch is named `master` (remote HEAD → master; no main branch), so the target is `origin/master` without renaming branches. Preserve owner `95594c4` and its Orca-only browser policy. [Publication procedure](007-011-publication.md) governs the separate Pi executor. No browser gate is being marked passed by this authorization; verification will continue afterward against the published application. Earlier no-push/conditional-merge statements below describe superseded checkpoints.

**Published:** Pi task `task_e8e9bac0ad87` / `ctx_ddacd3f3475d` committed plans at `a6fcfa6`, merged at **`fefdd4c`**, and normally pushed to `origin/master`. Lead independently verified remote equality, both parent histories, exact owner AGENTS.md preservation, matching reviewed application/docs, diff hygiene and clean status. Executor reran strict TypeScript and all 91 tests successfully. Worker released and delivery acknowledged. [Post-publication verification](011-post-publication-browser.md) now accepts the data, interaction and responsive visual criteria against that published source. Strict full modal Tab-wrap remains unproved: Taskdesk and a separate generic native dialog both lose Orca WebContents focus at the boundary, without focusing background application controls. This is not a demonstrated Taskdesk-specific defect or permission for a speculative source patch. See the final reviewed outcome and evidence there.

## Follow-up reliability and recovery/search features — 2026-09-26

Planned at `058e883`. The user selected all three new confirmed bugs and both product directions, authorized separate Orca implementation agents, review, and **conditional local integration into `master`**. No remote push or publication is authorized. The advisor writes plans/reviews only; separate executors own source changes, integration and the final merge. Baseline: Bun 1.4.2, strict TypeScript and all 75 tests pass; `bun audit --audit-level=high` reports no vulnerabilities in 238 packages. Original checkout initially clean.

| Plan | Outcome | Priority / effort / risk | Dependencies | Status |
| --- | --- | --- | --- | --- |
| [007](007-view-reference-choices.md) | Typed candidates in reference-board actions | P1 / M / LOW–MED | — | DONE — reviewed/integrated in `d23e17e`; Chromium keyboard/native save and desktop/mobile visuals verified |
| [008](008-native-property-drafts.md) | Rejected native property-creation draft retention | P1 / M / MED | — | DONE — source reviewed/integrated in `d23e17e`; trusted Chromium native submission/retention verified |
| [009](009-reference-id-presentation.md) | Working links and consistent mixed-case reference selection | P2 / S / LOW | — | DONE — source reviewed/integrated in `d23e17e`; combined canonical link opened successfully |
| [010](010-object-history-recovery.md) | Bounded revision history and safe historical drafts | P2 / M–L / MED | 007–009 | DONE — reviewed `50ce566`, 90 tests and independently rerun native recovery/conflict browser flow |
| [011](011-searchable-reference-selection.md) | Typed full-collection search with native select fallback | P2 / M–L / MED | 007–010 | PUBLISHED in `fefdd4c` — TS/91 tests pass; functional/visual gates accepted; strict modal Tab-wrap unproved (generic native dialog reproduces Orca page-focus boundary) |

Execution Run: `run_79461756ecab`. User clarified **Pi is the default and required agent**; all implementation/integration launches use Pi. Initial Claude launches stalled at login, were interrupted by the user, and made no code changes; their user-owned shell terminals are preserved. First Pi dispatch attempts stalled before prompt acceptance; after confirming the same terminals idle, explicit-terminal redispatch succeeded (`ctx_ee8e99557c94`, `ctx_8b1c2a0db329`, `ctx_0b265c5b5795`). No duplicate editor is active in a checkout. The configured Orca `npm install` hook is skipped because this project requires its checked-in Bun lockfile; executors use `bun install --frozen-lockfile` in isolated worktrees as needed.

Execution: the three isolated fix branches were integrated sequentially at `d23e17e`. Source review, strict TS, all 82 tests and diff hygiene passed independently. Later Chromium verification and repaired visual artifacts closed their native keyboard/button and responsive-capture gaps; earlier limited evidence remains honestly distinguished in the execution record. History was implemented from that immutable base and accepted at `50ce566` after the owner-approved final repair. Search was delivered at `8994485` but requires its first review repair; final master integration remains pending. Every executor runs focused tests, strict TS, full suite and diff hygiene; changed UI paths require actual browser keyboard/responsive/native checks. No real provider calls or user `.data` access. No master mutation until the integrated result and browser flows pass review; stop rather than mask failures. Preserve all worktrees/history, do not push or reset user work.

**Prior continuation checkpoint (resolved below):** the user's continue request was carried out through history implementation and two bounded review repairs. `6dcc925` resolves the earlier missing-schema/reference-label failures and passes independent TS, 89 tests and diff hygiene. Nevertheless, independent Chromium parsing plus real HTTP submission reproduced `first\nsecond` becoming `firstsecond` in a recovered text field. Plan 010 is BLOCKED rather than granting unsafe approval or silently starting a third round; its plan records the smallest targeted continuation and remaining native-flow evidence. Task `task_ac2863a95507` / dispatch `ctx_d283d7595515` completed and the Pi worker was released with its worktree/commits preserved. Both independent fixes browser workers are also completed/released; their four corrected desktop/mobile captures were independently accepted. Master remains `058e883`; search is unlaunched and no merge/push occurred.

**Owner-approved continuation:** the owner answered “approve” to one further bounded repair. [The focused repair plan](010-history-final-repair.md) was inlined into task `task_9e292093e6fc`, Pi dispatch `ctx_95f73f4eaa7d`, fresh terminal `term_c09f932d-9b74-4d42-bb6b-3483e4e46f1c` in the existing clean history checkout. No startup retry or duplicate writer. Scope was the text representability guard, regression tests, accurate fallback wording and complete native-history browser evidence; no ordinary editor rewrite. Delivered `50ce566` was accepted after independent diff review, strict TS, all 90 tests, hygiene and a fresh Chromium run (`/tmp/plan010-cdp-verify-XTu9b5/`). Worker released; `delivery_68b21e126af6` acknowledged. This tip already contains the reviewed fixes/history, so search can start directly from it without a redundant merge. Master remains unchanged.

Review details, actual verification and outstanding browser limits are in [the execution record](007-011-execution.md). All three original Pi workers completed a bounded review repair and were released with their branches/worktrees preserved. The search worker's initial delivery passed independent strict TS, 90 tests and scope/hygiene, but accepted an empty type filter, lost known labels for newly selected old references on native draft responses, weakened error-status tests, and omitted specified browser cases. [Review round 1](011-review-round-1.md) records the observed failures and evidence limits. Task `task_cd0e74174df3` / Pi `ctx_a3220f1826ea` delivered `1796ccf`; independent source review, 91 tests and a Chromium rerun passed. The source defects are closed; source is frozen. Some browser assertions still omit agreed cases, and the narrow screenshot contains a controlled disabled wrapper. [Final browser gate](011-final-browser-gate.md), task `task_8db771128453` / Pi `ctx_38f84b5fd427`, is the second/final search review follow-up and may write only temporary verification artifacts. All workers are now released and deliveries acknowledged. The final browser attempt was stopped on discovering concurrent owner commit `95594c4`, which requires Orca's built-in browser and forbids a separate-browser fallback. The lead's Orca probe confirms working snapshot/eval/trusted click, but Tab reports success without a keydown event or focus movement, even after switching/focusing the tab. Final UI acceptance is therefore blocked. Master is now the owner's `95594c4`; it was not changed by this workflow, and no feature integration or push occurred. Source remains clean at `1796ccf`. The seven remaining cases and precise probe are recorded in the final browser plan; its old CDP recipe is historical, not authorization for a workaround.

Vetted evidence: view candidates (`src/objects/http.ts:187–193`, `render.tsx:97,442`); rejected property drafts (`http.ts:215–228`, `render.tsx:261`); mixed-case reference links (`runtime.ts:374–381`, `render.tsx:12,112`, `http.ts:175`). All reproduced with in-memory databases and real HTTP. Optional directions are grounded in stored `object_revisions` and existing bounded lookup, not new services or general-purpose frameworks.

**Resumed on owner “continue”:** source/master hashes are unchanged. A fresh probe reproduced missing key events only in a background worktree tab with `document.hasFocus() === false`; a tab in the visible original worktree delivered trusted Tab down/up and moved focus First → Second. The final browser plan is refreshed to **Orca only**. Task `task_dbb393625f45` / Pi `ctx_de62d38e124e` runs from the original worktree for visible browser placement, but tests the frozen reviewed application's absolute imports. No repository edits, extra source repair, integration or push is authorized for that verifier. The earlier keyboard-block conclusion is narrowed to background/focus placement. That first resumed worker stopped/released with one controlled-click probe and six unverified cases. Subsequent lead probes established the missing step: DOM focus alone is insufficient, but a **real Orca click before Tab** gives trusted keyboard events and real movement. One bounded harness-only retry is now `task_655e3cc13a8b` / Pi `ctx_3012ad549a4b`; it must correct the reviewed assertions and use fresh fixture tabs instead of navigating out of dirty drafts. Source is unchanged; lead independently reran TypeScript and 91 passing tests. **Retry is now STOPPED/released:** actual Title click → trusted Tab works, and an old reference was selected through the modal; Writing textbox click/type did not establish editor focus or change content. No completed final gate or accepted screenshots. Report `/tmp/plan011-orca-retry/report.md`. All owned resources cleaned up and deliveries acknowledged; no worker active and no integration. This supersedes the blanket Tab blocker, but is not a demonstrated application defect.

### Considered and rejected / audit limits
- Input-bound `notEquals` is explicitly supported negative filtering, not a scope bypass.
- Supplying a current `reviewedRevision` is the existing explicit reconciliation contract; checking an arbitrary original revision's historical existence would not add a separate authorization boundary. No confirmed lost-update bypass.
- Ctrl/Command+K from another modal was not shown to fail; native modal stacking alone is not evidence of a bug. Do not change this shortcut speculatively.
- Per-type browsing currently misses the type-specific index with its optional OR predicate. An in-memory 10,020-row probe measured ~1.68 ms vs ~0.032 ms for a direct type predicate; not prioritized as current user-facing latency or used to justify caching.
- Broad file-size refactors, dependency churn, multi-user auth, plugins, notifications, sync, and issue/vault tooling remain out of scope. Known broad generator/editor test gaps are not duplicated as new findings.
- Audit did not inspect real user data/credentials, run real model generation, exhaustively review dependency internals, or verify browser layout/focus. These limits do not waive the implementation browser gates above.

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
