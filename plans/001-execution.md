# Plan 001 execution record

Started 2026-09-26 after the owner's “let's go” authorization. Initial execution excluded publication. The owner subsequently authorized continuation and pushing **pi-orca only** to `https://github.com/alexradunet/pi-orca-subagents.git`. Global rollout, package removal, and Taskdesk source/data changes remain unauthorized.

## Preflight

- Taskdesk baseline `2403c1a`; no drift in `AGENTS.md`, `src/pi.ts`, or `test/pi.test.ts`.
- Pre-existing untracked entries: `.agents/`, `plans/`, `skills-lock.json`.
- Pi `0.86.1`, Bun `1.4.2`, Orca `1.4.192`.
- Configured worker default: `openai-codex/gpt-5.5`, medium reasoning. This is configuration evidence, not yet a worker model observation.
- Coordinator Run: `run_47533ecf4333`.
- Proven coordinator launch handle: `term_eda81010-6ce6-4a9c-9803-755eeb8617a6`; Run binding matches the actual `ORCA_TERMINAL_HANDLE`.
- Important discovery: unqualified `terminal show` selected a different visible terminal. Exact launch identity, not active UI selection, must govern the bridge.

## Attempts

| Role | Task | Dispatch | State |
| --- | --- | --- | --- |
| Bootstrap two new local repositories | `task_f27a963ba44a` | `ctx_dab7f5a334a5` | succeeded; verified; released |
| Smoke A: blocking question and isolated edit | `task_e77e26aa394d` | `ctx_ee2ccecf3ee8` | succeeded; verified; released |
| Smoke B: independent isolated edit | `task_10c6e7a71f14` | `ctx_09ad05a15567` | succeeded; verified; released |
| Implement bridge steps 2–5 | `task_2f1d0f021314` | `ctx_1c4ab244a697` | candidate committed; 24 tests verified; terminal retained by runtime as user-owned |
| Read-only launcher/inspection contract scout | `task_cfd6376551ec` | `ctx_539a602615ef` | completed; findings vetted; released |

The bootstrap worker runs in a fresh Orca Pi terminal, `term_a93ce392-5bad-42cb-9e3f-0e37c792ea56`, attached to the existing Taskdesk worktree with an explicit **read-only boundary on that entire checkout**. Its sole write scope is the absent `/home/alex/Work/pi-orca` and a newly allocated `/tmp/pi-orca-smoke-*` fixture repository. It must create minimal clean baseline commits and register those repositories, then report and idle. It does not implement the extension or spawn workers.

## Native proof — PASS

- Tooling repository: `/home/alex/Work/pi-orca`, Orca repo `86bab9b0-aa0f-477f-b7cf-017aadd9f55a`, clean `main` baseline `bd73766cc8c94bd382d274a7ac288ab0974e00b2`.
- Fixture repository: `/tmp/pi-orca-smoke-WExO6Nvw`, Orca repo `82d45ea7-e3a7-4510-adf0-aa98dbca44eb`, clean `main` baseline `92b87a89bfcd777b4a3e8439cd2830884b1a9526`.
- Smoke worktrees: `/home/alex/orca/workspaces/pi-orca-smoke-WExO6Nvw/pi-orca-smoke-a` and sibling `pi-orca-smoke-b`, both launched before waiting and active concurrently.
- A asked `msg_901e5c854f60`; the coordinator answered **Beta** via exact message ID. Its fixture actually contains `# Beta`; commit `e5be30dfe20c5c71d9186cda6efab00b9902c6e0` changes only `smoke-a.md`.
- B committed `4902649d36c6c565c0d7ee3fe607ce505b810f8c`, changing only `smoke-b.md` with the expected independent-edit text.
- Both worktrees and the original fixture repository are clean. The original remains at its baseline. Both `worker_done` outcomes are succeeded; all three created worker terminals were released through Orca with captured output.
- Unacknowledged delivery `delivery_7a364b9f6c92` replayed with the same ID and `replayed: true`. Reply receipt marked the question answered. Acknowledging B's completion returned A's next completion; both were handled before their acknowledgements.
- A finite empty inbox wait returned `timedOut: true`, with no inferred worker failure.
- Exact non-secret receipts are under `plans/evidence/`. The workers used the existing default Pi configuration; old packages were not used for coordination but were still installed/loaded. This is **native Orca proof**, not the later old-extensions-unloaded bridge gate.
- Bootstrap and smoke B reported actual `openai-codex/gpt-5.5` / medium worker settings.

## Implementation candidate — offline checks PASS

- Sole writer: `/home/alex/orca/workspaces/pi-orca/implement-orca-bridge`, branch `implement-orca-bridge`, based on tooling `main` / `bd73766`.
- Worker terminal: `term_02c8340a-db4d-43ba-bb46-8231043ce223`.
- Assigned only steps 2–5: implementation, offline tests, workflow/migration documentation. Full plan was inlined (42,339-byte task brief); native prerequisite evidence supplied explicitly. No live nested workers or global rollout authorized to the writer.
- Independent read-only scout ran in tooling main, terminal `term_a8a9a1a3-ceea-4895-acfc-893f24b47b8a`, checking supported isolated Pi launch and durable question-inspection contracts. It did not mutate files/config or spawn workers; its terminal was released.
- Candidate commit: `fd52e23be8fbe5dd8003f54e05e2812d3b6c27ed`. The worker checkout is clean; tooling `main` remains at baseline `bd73766`. No merge or installation occurred.
- Candidate contains the two tools, `/orca`, one workflow skill, strict provider-free tests, sanitized fixtures, migration instructions, and an unapplied improve patch. Report: `/home/alex/orca/workspaces/pi-orca/implement-orca-bridge/docs/implementation-report.md`.
- Parent independently reran `bun run check`, `bun test` (**24 pass, 0 fail**), `git diff --check`, and checkout status. Evidence: `plans/evidence/bridge-parent-checks.log`. Offline checks do not establish automatic/live acceptance.

## Review checkpoints

- Taskdesk baseline verification passed: `bun run check`, then **64 tests passed, 0 failed**. Log: `plans/evidence/taskdesk-baseline-tests.log`. No application files changed.
- Launcher scout confirmed the documented custom-terminal path for `pi --no-extensions -e <actual-entry>`; the fixture repository has no setup hook and starts immediately. `worker-start --terminal` can supervise that explicitly created terminal, but cleanup may retain pre-existing/user-owned terminals. No global launcher setting was changed.
- Rejected two inaccuracies in the scout's report: its illustrative `/bridge/src/index.ts` path was not a real path; worker `ask --resume` is not proven coordinator-side question inspection.
- Parent's early source review found real first-draft gaps: string payload parsing, polling after acknowledgement, ownership validation across reload, durable admission/reply state, verified cleanup, bounded output, and tests using invented rather than observed response shapes. Concrete correction instructions were sent to the same writer; no acceptance was granted.
- The writer explicitly asked for missing public inspection contracts (`msg_912376b9cc5b`); the parent gathered `worker-list`, `worker-show`, exact terminal, and Run evidence and answered via Orca. The reply and acknowledgement succeeded. Conservative pause on a lost reply receipt is required; no guessed coordinator `ask --resume` or automatic mutation retry.
- A second bounded worker question (`msg_4f4a97e7d8ce`) asked about unsupported retention forms. Approved fail-closed acknowledgement, with those cases explicitly remaining live blockers; no invented retention receipt or forced test retention.
- Follow-up source review corrected stale reply/ack success after pause, pre-attach ownership inspection, and pre-aborted calls spawning effects. Regression tests passed; these observations are not an independent reviewer or a live test.
- Completion `msg_31ac691b165a` was inspected. `worker-release` returned `retained` / `user_takeover` / `processAction: none`; the runtime identifies the terminal as user-owned, so it was not force-closed. Completion Delivery `delivery_5865cd08c17a` was acknowledged, returning no next batch.
- Final worker accounting: all five attempts settled; four terminals released and the implementation terminal retained as user-owned. Worktrees, fixture commits and reports remain intact.

## Stop point — live gate BLOCKED pending launch decision

The candidate is not accepted for rollout. The installed `worker-start` does not offer Pi model/argument overrides, and no supported per-repository Pi launcher setter was found. Explicit `terminal create --command 'pi --no-extensions -e <actual-entry>'`, followed by supervised `worker-start --terminal`, is a documented alternative, but differs from the bridge's current new-top-level launch path and may yield an unproven pre-existing-terminal cleanup form. Do not silently change global launch settings, substitute a provider, or claim this proves `orca_delegate` end to end.

Before more paid testing, agree with the owner on that scoped launch alternative and the budget for a dedicated lead plus two short workers (and an optional separately approved stop attempt). Preserve all existing packages/settings. Further automatic wakeup, busy delivery, reload/session ownership, failure/stop, old-extensions-unloaded operation, and applicable retention cases remain **NOT RUN**. Lost reply receipts and unknown task-creation outcomes intentionally require manual reconciliation, not automatic retry.

At that first stop point, no implementation worker remained assigned and publication was not authorized. The following continuation supersedes only that publication restriction; the advisor still writes only under `plans/`.

## Authorized continuation and publication — PASS

The owner said: “Let's continue and let's push pi-orca to https://github.com/alexradunet/pi-orca-subagents.git”.

- GitHub target was verified **public and empty**. Publishing to that exact repository is authorized; no remote creation, visibility change, force push, release, or npm publication was needed.
- Integration Task `task_e0669165e7ab`, Dispatch `ctx_3ae1cad8d694`, fresh terminal `term_0db1ddbc-bd08-4d76-a4a5-98a7ce7c03b3`, sole writer in `/home/alex/Work/pi-orca`.
- Worker fast-forwarded local `main` to the reviewed candidate, added a prominent experimental warning and portable GitHub clone/install instructions, and committed publication evidence.
- Parent independently verified remote `main` equals local `6d938281e5ad6cda8f7ccbf65843adc90f1990a6`. Only `README.md` and `docs/publication-report.md` changed after the candidate. Checkout clean; 24 tests and strict checking passed.
- Source/history review found no credential/private-key hits; raw private session transcripts are not published.
- Worker terminal was released through Orca; completion acknowledged. Source is published, **not installed or accepted for replacement**.

## Isolated live trial — FAILED / acceptance BLOCKED

- Dedicated lead: terminal `term_e2d8160a-c9f1-4d11-8cbd-c41806bd08d9`, fixture root `/tmp/pi-orca-smoke-WExO6Nvw`, invoked with `pi --no-extensions -e /home/alex/orca/workspaces/pi-orca/implement-orca-bridge/src/index.ts`.
- Pi 0.86.1 loaded only the new extension. Actual old coordination tools absent; actual model `openai-codex/gpt-5.5`, medium. `/orca start` successfully created/bound **`run_97fa33433029`**; this load/binding check passed.
- Root test lead received authorization for exactly two custom-argv workers, no retries. Both worktrees were top-level with setup policy preserved, based on fixture `92b87a8`: `live-bridge-a` and `live-bridge-b` under `/home/alex/orca/workspaces/pi-orca-smoke-WExO6Nvw/`.
- A: Task `task_b6f2cbcb34cc`, Dispatch `ctx_80f6529b98e0`, terminal `term_2375cb5a-2ef4-4d09-b24b-9c9d21dc0abf`.
- B: Task `task_5634a27abc56`, Dispatch `ctx_55f6a9e43f0f`, terminal `term_d21cac3f-5f3f-461c-adb2-9a7b9ed24d83`.
- Both `worker-start --terminal` calls reported **`failed` / `dispatch_input` / `agent_prompt_stalled`**, yet prompts actually executed. No replacement or repeated launch was attempted. A's later `ask` was rejected because its supervised Dispatch was no longer active; it modified no files. B committed only `live-b.md` at `6efda3a`, ran the intentional failing assertion (`AssertionError [ERR_ASSERTION]: 1 == 2`), and honestly reported failed. Both checkout states were independently inspected.
- `worker-release` retained both as `external_terminal`, `processAction: none`; authoritative resource state was `ownershipState: external`, `releaseState: not_requested`, with exact original Dispatch ownership. No external terminal was force-closed; no worktree was deleted.

### Test-procedure failure — not bridge acceptance

The test lead redundantly called raw `orchestration run-use` at 12:27:41 after `/orca start` already bound the bridge. A checkpoint became paused about 200 ms later, with TUI error `Invalid inbox authority/connection state`. The exact underlying returned cancellation record was not retained; a causal diagnosis beyond this event ordering is unproven.

Two later **native Orca runtime nudges** appeared as user-role messages, not the bridge's attributed custom messages. The test lead called `orca_inbox pending`, got `No active Delivery`, then incorrectly used raw CLI `check`/`ack` despite explicit test instructions. Those acknowledgements are **not** bridge cleanup/ack proof. Parent reviewed the exact test session's selected events: no `custom_message` injection; stored inbox Delivery remained null. The final test-lead report corrects the classification.

- Evidence: `plans/evidence/live-session-events.json` contains only selected checkpoint/tool event metadata, not a full private transcript.
- Fixture report: `/tmp/pi-orca-smoke-WExO6Nvw/live-lead-report.md`.
- Parent explicitly paused the bridge and stopped the trial; lead confirmed no retries/new workers and ended idle. Both worker attempts settled failed and their external terminals remain preserved.
- Automatic bridge wakeup, question/reply continuation, bridge acknowledgement, busy delivery, reload/replay, direct `orca_delegate` launch, and stop acceptance remain **unverified**. This failed trial does not establish an extension source-code defect; it establishes runtime launch/input-readiness and test-procedure blockers.

Next: diagnose a supported Pi launch that preserves readiness/supervision while unloading old tools, avoid raw Run rebinding/consumption in a bridge-owned session, and agree on a bounded retry before more provider-backed testing. Do not silently substitute providers/protocols or change global settings. The observed native Orca nudges should also be accounted for before attributing any future automatic wakeup to this extension.

Docs-only executor `task_e66d374feb1f` / `ctx_c803a75bb87c` published the failed trial record and workflow warning at `ea5c336`. Parent caught an overclaim in its explicit-stop row: preserved files are not evidence of an actual `worker-stop` test. A bounded correction executor (`task_038f8ad8c18e` / `ctx_4ca50325b7a5`) corrected that to NOT RUN and clarified the unretained error record; parent inspected the exact two-line diff.

### Final continuation handoff

- **Published remote/local main:** `8d98328fd93a7e6c9311503cede5ba8861732aa1`, independently verified with `git ls-remote`. Main checkout clean; no source, dependency, lockfile or test changes after candidate `fd52e23`.
- Parent reran strict TypeScript and all **24 tests passed**, with `git diff --check` passing. Log: `plans/evidence/published-parent-checks.log`.
- All three publication/documentation executor terminals were released; their completion Deliveries acknowledged. Outer coordinator inbox empty at final check.
- Dedicated test lead remains paused/idle with no child CLI process at final inspection. Both failed custom worker terminals are runtime-retained external terminals; fixture worktrees and report preserved. No forced process closure or worktree deletion.
- Taskdesk tracked source/instructions and embedded Pi isolation files remain unchanged; existing `.agents/`, `plans/`, and `skills-lock.json` remain untracked. No global Pi configuration or old-package change.
- **Source publication is finished. Replacement acceptance is not.** No active source executor or further live retry remains assigned.
