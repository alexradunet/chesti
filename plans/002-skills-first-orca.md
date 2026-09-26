# Plan 002: Use native Orca tools with a small development skill

> Package-maintenance scope superseded by completed [Plan 003](003-local-orca-skill.md): one standalone local skill, project rules, and an archived repository. The verification history below remains accurate; legacy-package migration was not performed.

## Decision and scope

- Status: PAUSED at rollout decision; owner approved execution and the Pareto scope on 2026-09-26. Skills-only code is published; native idle wake was not observed, so old packages remain installed.
- Supersedes Plan 001's custom bridge architecture, not its safety/data boundaries.
- Planned at pi-orca `8d98328`, Taskdesk `2403c1a`.
- Outcome: the lead LLM chooses an effective process using current tools; Orca owns execution and durable coordination. Avoid scripting the model's planning decisions.
- Implementation: `/home/alex/Work/pi-orca`; published remote `https://github.com/alexradunet/pi-orca-subagents.git`.

The owner explicitly agreed to a skills-first replacement, a short native smoke test with old resources disabled, then reversible retirement of the old packages if the test succeeds. Existing work and unrelated configuration must be preserved. No Taskdesk application code/data changes, worktree deletion, broad trust policy, model/provider fallback, or credential access.

## Smallest complete approach

1. Replace the package's extension with one concise `orca-development` skill. Remove bridge source/tests/dependencies/build machinery; Git history retains the experiment. Keep a small README and migration/verification record. Let the lead choose direct work, workers, concurrency and reviews within authorized scope/budget. Keep exact identities, one writer per checkout, honest evidence, whole-Delivery handling, no blind mutation retries, safe cleanup and human publication authority.
2. Validate real YAML frontmatter, manifest/resource paths, and documentation rather than maintaining tests for deleted runtime code. The package has no runtime/build target after this replacement.
3. Prepare only the existing disposable fixture's `.pi/settings.json` with documented package object filters for `npm:pi-subagents` and `npm:pi-intercom` (`extensions`, `skills`, `prompts`, `themes`: empty arrays). Leave unrelated packages and native Orca launch integration alone. Preserve the untracked previous `live-lead-report.md`.
4. Use narrowly scoped Pi trust for the fixture root/worktree parent only, through the documented trust flow. Do not trust all `/tmp` or all Orca workspaces. Launch with native Orca `--agent pi`, not blanket `--no-extensions` custom worker commands.
5. Verify two independent native workers, exact question/reply continuation, idle-lead notification, actual outcomes and resource accounting with old tools absent. These are outcome checks, not a required production algorithm. Stop on an unknown launch; no open-ended retries.
6. After acceptance, inspect active legacy work; preserve a private settings backup without credential files. Install the skills-only local package and use supported Pi package removal for the two named old packages only. Preserve `pi-web-access` and unrelated settings. If active legacy work would be interrupted, defer removal rather than kill it. Verify a fresh session's actual resources, not only a package inventory.
7. Add only a short Taskdesk development-workflow note and narrow improve execution adaptation if needed. Preserve the advisor's read-only role, owner files and embedded Pi isolation. Do not commit the pre-existing untracked skill wholesale or fabricate lock hashes. Run Taskdesk `bun test test/pi.test.ts`, `bun run check`, and `bun test` after instruction rollout.

## Current execution and evidence

- Package writer: `task_639b96f4000e` / `ctx_a48dd0f7dab9`, branch/worktree `skills-first`, `/home/alex/orca/workspaces/pi-orca/skills-first`. Candidate `afdd9da` removed the custom bridge and its obsolete machinery.
- Parent review approved the scope but reproduced invalid YAML in an unquoted description (`Orca: choose`). Follow-up `task_783c79bbbff0` / `ctx_5ba1ec7eda7a` corrects it with real parser verification and is authorized to fast-forward/push the reviewed skills-only result.
- Fixture writer: `task_3b68bc65094c` / `ctx_07602704640c`, `/tmp/pi-orca-smoke-WExO6Nvw`; committed only `.pi/settings.json` at `65bcb6f`. Previous report remains untracked/unstaged.
- Fixture trust follow-up: `task_318de586afb3` / `ctx_dfd16f0f61b7`, same exact worker reused. An initial reuse command omitted the explicit worktree and failed preflight `terminal_worktree_mismatch`. Parent verified `dispatch: null`, unchanged fixture ref/status, then corrected the same protocol with the exact fixture worktree; no duplicate attempt was created.
- Both original completions were accounted through immediate same-terminal reuse before acknowledgement.
- Legacy inventory: no active pi-subagents fleet; Intercom roster showed only this coordinator, retained implementation session and the two current Orca executors, all other sessions idle. Inventory must be rechecked before removal.
- Selected CLI `orca-ide`; Pi 0.86.1, Orca 1.4.192. Package/trust behavior checked against installed Pi `packages.md`, `skills.md`, `settings.md` and the current Orca guides.
- Receipts are under `plans/evidence/skills-*`, `native-filter-*`, and `fixture-trust-*`.

## Acceptance and rollback

- [x] Skills-only package is valid, reviewed, and published; no second runtime remains. Final local/remote main is `cdc68142fde64bc35da0faa26ada073452ac1acc`, clean; real YAML/manifest and diff hygiene independently rechecked.
- [ ] Scoped native smoke fully accepted: normal starts, exact question/reply and intentional failure preservation passed; idle wake did not. Wait-based supervision vs a minimal wake facility is the remaining owner choice, not a silent requirement reduction.
- [ ] Active old-tool work is accounted; settings backup and exact rollback sources recorded privately.
- [ ] Package migration succeeds and fresh-session resources are verified.
- [ ] Relevant development instructions and Taskdesk isolation/normal checks pass.
- [ ] Reports distinguish implemented/verified outcomes from remaining limitations.

Rollback restores only affected package entries/resources, not entire unrelated settings or live Orca history. Recorded former package versions are `pi-subagents@0.71.0` and `pi-intercom@0.14.0`; verify availability before relying on reinstall. Keep fixture and worker changes inspectable. Never retry an uncertain worker creation just to obtain a clean report.

## Native test result and remaining decision

Run `run_3ff08c7bb1c0`, root terminal `term_f9328897-5f63-4ee1-bebe-bcb052a27370`, root checkout `/home/alex/orca/workspaces/pi-orca-smoke-WExO6Nvw/skills-native-lead`:

- Normal native launches: both ready, not the old `agent_prompt_stalled` failure.
- A: `task_e0cbb890bffb` / `ctx_b5f48cb10b98`, exact Beta answer and only `native-a.md` committed at `a60048604425caad83f6e3c53caef3e8537820b2`.
- B: `task_0a9ee01d569e` / `ctx_80c6cd5137d2`, only `native-b.md` committed at `1c4b6e77b791e06c555f1685790fcf72265a4e05`; intentional assertion exit 1 remains a failed outcome.
- Root actual tool-name list excluded old tools; workers reported absence. PATH checks and broad `functions` namespace claims alone are not independent proof. Trusted project filters provide the scoped resource-exclusion mechanism.
- Root ended at `13:13:13.062Z`; no native mailbox message appeared. Parent manually resumed it at `13:20:32.676Z` to settle the same workers. No new workers, Run takeover or duplicate question were used. Exact selected session events: `plans/evidence/skills-native-session-events.json`.
- A native question and B completion arrived together in `delivery_e58f2788b346`; A completion followed in `delivery_16421206f815`. Root accounted and acknowledged both.
- Both worker terminals exited with `operator_close` and captured archives. Runtime cleanup remains `release_unknown` / `tab_not_found` even after documented same-request recovery. Preserve this discrepancy, not a fake clean release. Source-integration worker `ctx_5ba1ec7eda7a` showed the same discrepancy. No broad terminal close or worktree deletion was used.
- Root report `native-acceptance.md` committed at `fa6197d`; child worktrees/commits and fixture-created `.pi/npm/` caches are preserved. Global package entries were not altered.
- Final docs executor: `task_ccb810635b52` / `ctx_644795868e96` published truthful partial-test evidence and concise wait/idle guidance at `cdc6814`. Parent reviewed exact diff and remote hash; worker released normally (`closed_agent_terminal`, captured archive), completion Delivery acknowledged, outer inbox empty. No rollout authorization from that assignment.
- Final package inventory remains exactly `npm:pi-web-access`, `npm:pi-subagents`, `npm:pi-intercom`; skills-only package is published, not installed. Taskdesk tracked files remain unchanged, as do its pre-existing untracked `.agents/` and `skills-lock.json`. No new application tests were needed/run for this documentation-only package finalization; the recorded Taskdesk baseline is historical.

Recommended smallest next step: accept bounded native `check --wait` as the lead's supervision method, not a promise that an ended Pi turn resumes automatically. If automatic idle resume is still required, discuss a genuinely minimal missing piece rather than restoring the discarded framework. Do not run another paid test or remove old packages before resolving this material behavior choice.

The old bridge's elaborate Pi fork/tree synchronization, custom admission accounting and API compatibility are deliberately not acceptance gates for a package that contains no extension. Orca's real state and the lead's judgment replace those mechanisms; correctness and data preservation remain required.
