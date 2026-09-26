# Plan 001: Replace overlapping Pi coordination tools with a thin Orca bridge

> **SUPERSEDED:** The owner chose a skills-first, native Orca workflow. Follow [Plan 002](002-skills-first-orca.md), not this historical bridge implementation/acceptance matrix. The experiment is preserved at pi-orca `8d98328`; current main has no extension runtime.

> **Executor instructions:** This is an implementation handoff, not an instruction to immediately uninstall packages. Read the whole plan, verify the runtime contract, and implement in the separate tooling repository named below. The advisor remains read-only on source; an explicitly authorized executor performs implementation. Do not start Taskdesk feature work, merge into its main branch, publish a repository, or change global Pi settings without the stated gates.
>
> **Drift check:** In `/home/alex/Work/GenUIExperiment`, run `git diff --stat 2403c1a..HEAD -- AGENTS.md src/pi.ts test/pi.test.ts`, then `git status --short`. Re-read the excerpts below if these files changed. The improve skill is currently untracked, so inspect its live content separately; Git cannot establish its baseline. Re-read the installed Orca guides and Pi documentation, and record their versions. Changed CLI behavior must be reconciled before implementation, not hidden behind a compatibility fallback.

## Status

- **Priority:** P1
- **Effort:** M–L; allow several days including live lifecycle tests, not a one-file afternoon demo
- **Risk:** MED; incorrect routing, acknowledgements, or retries can lose questions or duplicate paid workers
- **Depends on:** none
- **Category:** dx / direction
- **Planned at:** Taskdesk commit `2403c1a`, 2026-09-26
- **Status:** PUBLISHED experimentally, BLOCKED at live acceptance — native proof passed; candidate `fd52e23` passed strict checking and 24 provider-free tests. Approved isolated trial failed with `agent_prompt_stalled` plus a test-driver Run-rebinding/CLI-bypass error. See [execution record](001-execution.md). No rollout or global removal.
- **Implementation repository:** `/home/alex/Work/pi-orca`; candidate fast-forwarded into `main` and pushed, with explicit owner approval, to `https://github.com/alexradunet/pi-orca-subagents.git`. Original implementation worktree is preserved.

## Why this matters

The owner wants one strong Pi lead to use the improve skill, select work, develop in parallel through isolated worktrees, receive worker questions, and accept verified results. Orca already owns worktrees, terminals, tasks, worker lifecycle, and structured messages. Keeping a second worker manager and messaging broker duplicates responsibilities. A small bridge should make Orca's existing capabilities convenient in Pi, especially waking the lead when a worker asks a question or finishes, without implementing another orchestration platform.

This deliberately trades standalone-Pi portability for a workflow that requires a running Orca runtime and an identifiable Orca coordinator terminal.

## Current state and evidence

### Installed environment, observed rather than assumed

- Pi CLI: `0.86.1`.
- Orca runtime: `1.4.192`, running and reachable; `orchestration run-list --json` succeeded.
- Omarchy: `4.0.4-1`; no desktop changes are needed for this plan.
- Bun: `1.4.2`.
- Pi user packages: `npm:pi-subagents` version `0.71.0`, `npm:pi-intercom` version `0.14.0`, and unrelated `npm:pi-web-access`.
- This application checkout is already tracked by Orca, at `/home/alex/Work/GenUIExperiment`, branch `master`.
- Existing untracked owner files: `.agents/` and `skills-lock.json`. Do not clean, stage, overwrite, or assume they exist in new Git worktrees.
- Orca has unrelated historical/live Run records. They are not test fixtures; do not bind to, acknowledge, reset, or stop them.
- No worker launch, message round trip, custom extension, or package removal was tested during planning.

### Important correction about improve

`.agents/skills/improve/SKILL.md:18`:

> Never modify source code yourself. ... a separate executor subagent edits code in an isolated git worktree ... never merge, push, or commit to the user's branch.

`.agents/skills/improve/references/closing-the-loop.md:19` currently says:

> Spawn one general-purpose subagent with isolation: worktree. Executor model: default sonnet ...

The skill does **not** literally depend on the `pi-subagents` package; its execution recipe assumes a different host's generic subagent API and model naming. Adapt that recipe to Orca's real Run/Task/Dispatch contract. Preserve its advisory-only role, plan selection, evidence review, and human publication authority. Do not blindly replace package names or make the advisor a source-code writer.

### Taskdesk boundaries remain unchanged

`AGENTS.md:55`:

> View generation receives the intended schema metadata and user-supplied prompt context, not automatic access to object contents, files, shell, personal agent instructions, or extensions.

`src/pi.ts:1–12`:

```ts
import { createExtensionRuntime, type ResourceLoader } from '@earendil-works/pi-coding-agent';

// No standard discovery: personal extensions, shell tools, context files,
// skills and settings must not leak into an embedded application session.
export function isolatedResources(prompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
```

`test/pi.test.ts:1–12` is both the isolation regression and the test-style exemplar:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedResources } from '../src/pi.js';

test('embedded Pi resource loader does not discover personal extensions, skills or context', async () => {
  const resources = isolatedResources('Submit a declarative view.');
  await resources.reload();
  assert.deepEqual(resources.getExtensions().extensions, []);
  assert.deepEqual(resources.getSkills().skills, []);
  assert.deepEqual(resources.getAgentsFiles().agentsFiles, []);
```

Use strict TypeScript, ordinary functions, `node:test`, and `node:assert/strict` in the new tooling repository. Use Bun for dependency installation, checking, and tests, but make extension runtime code work in Pi's runtime using Node built-ins. Worktrees separate Git checkouts, **not security sandboxes**: workers still run with the user's filesystem permissions.

## Ownership model

| Responsibility | Owner |
| --- | --- |
| Product scope, prioritization, parallel decomposition, acceptance | Strong lead Pi agent, subject to user decisions |
| Audit findings and self-contained plans | Improve advisor phase |
| Worktrees, terminals, Run/Task/Dispatch state, messages, completion | Orca |
| Pi-facing launch convenience and automatic inbox delivery | This extension |
| Source edits and tests for a bounded task | One assigned worker per worktree |
| Integration of accepted branches and conflict fixes | Explicit integration worker; no competing writer |
| Merge/push/publication authorization | Human; never inferred from worker success |

Orca completion means the attempt reported a result, not that tests passed or the lead accepted it. Start with a concurrency ceiling of four workers **for the bound Run**, explicitly adjustable by the user. Dispatch all ready independent work up to that ceiling; refill slots as work settles. Do not launch workers simply to fill slots. No recursive workers in v1.

## Documentation and toolkit

Read these files completely before implementation; follow relevant cross-references for APIs actually used:

- `/home/alex/.local/share/mise/installs/pi/0.86.1/pi/docs/extensions.md`
- `/home/alex/.local/share/mise/installs/pi/0.86.1/pi/docs/session-format.md`
- `/home/alex/.local/share/mise/installs/pi/0.86.1/pi/docs/packages.md`
- `/home/alex/.local/share/mise/installs/pi/0.86.1/pi/docs/skills.md`
- `/home/alex/.local/share/mise/installs/pi/0.86.1/pi/docs/prompt-templates.md`
- `docs/tui.md` under that same Pi installation if adding any custom UI; prefer standard text and `setStatus` instead.
- Pi examples `examples/extensions/send-user-message.ts`, `file-trigger.ts`, and `truncated-tool.ts` under that installation. The file-watcher example illustrates `sendMessage`, not a production lifecycle/recovery implementation.
- `/home/alex/.agents/skills/orca-cli/SKILL.md`
- `/home/alex/.agents/skills/orchestration/SKILL.md`
- Live guides: `orca-ide skills get orca-cli` and `orca-ide skills get orchestration`.
- Intercom README for comparison: `https://github.com/nicobailon/pi-intercom` (read during planning).

Resolve the Orca executable once per session: use the explicit `ORCA_CLI_COMMAND` if supplied; otherwise the dev CLI only for a declared Orca-dev environment; on Linux outside managed terminals use `orca-ide`. Never fall through to bare `orca` after an error—it may be the GNOME screen reader. Never guess command syntax from this plan when the installed version disagrees.

## Scope

### In scope during implementation

Create the separate local tooling repository only if the proposed path is still absent, or the owner confirms the existing contents belong to this work:

```text
/home/alex/Work/pi-orca/
  package.json
  bun.lock
  tsconfig.json
  .gitignore
  README.md
  AGENTS.md
  src/index.ts
  src/orca.ts
  src/inbox.ts
  test/orca.test.ts
  test/inbox.test.ts
  test/lifecycle.test.ts
  test/fixtures/                 # small, sanitized observed CLI response shapes
  skills/orca-development/SKILL.md
  docs/live-verification.md
  docs/migration.md
  docs/improve-orca.patch        # reviewed narrow adaptation, not a second skill fork
```

Keep responsibilities cohesive: `index.ts` binds Pi tools/events/commands, `orca.ts` executes and validates CLI calls, `inbox.ts` handles delivery lifecycle. Fewer files are acceptable if clearer; do not introduce repositories, an event bus, plugins, or a general scheduler. Tests and documentation may be split when a real responsibility warrants it.

Live verification additionally permits a newly allocated `/tmp/pi-orca-smoke-*` fixture repository and its explicitly created Orca worktrees, Runs, Tasks, and terminals. Record every path/identity; these are not disposable references to existing user work. A supported configuration change scoped to that trial repository is allowed with execution-stage approval, a recorded original value, and rollback. No broad change to every Orca project is permitted. Smoke artifacts must not access Taskdesk's real database.

After successful acceptance and **separate rollout approval**, these narrow changes are permitted:

- Taskdesk `AGENTS.md`: a short development-workflow section, not a duplicate manual.
- Taskdesk `.agents/skills/improve/SKILL.md` and `references/closing-the-loop.md`: review/execute instructions only; preserve all advisor restrictions and other workflows. Explicitly decide how the currently untracked skill will be shared.
- User Pi package configuration via Pi's supported package commands; preserve all unrelated settings and packages.

### Out of scope

- Taskdesk `src/`, `public/`, package dependencies, database, and model-generation permissions.
- New Taskdesk features, safe preview launcher, or browser test automation; those are separate work.
- Modifying Orca, Pi core, or installed third-party package source.
- A custom broker, daemon, network service, task database, PTY manager, Git-worktree manager, scheduler, automatic merge bot, cross-machine support, arbitrary agent-provider support, or custom TUI dashboard.
- Automatic model selection, automatic model fallback, automatic retries of unknown launches, limitless spawning, recursive workers, or automatic paid review schedules.
- Reading authentication values, publishing artifacts, global blanket project trust, deleting worktrees, or clearing orchestration history.

## Commands and verified contract

These commands were discovered from the installed guides/help. Angle-bracket values are runtime-returned identifiers or explicitly selected inputs, not literal arguments. Do not derive terminal handles from names, cwd, or roster ordering.

| Purpose | Command | Success evidence |
| --- | --- | --- |
| Runtime | `orca-ide status --json` | `ok: true`, reachable runtime |
| Discover guides | `orca-ide skills get orchestration` | Current command and lifecycle contract |
| Package inventory | `pi list` | Existing package sources retained |
| Create/bind Run | `orca-ide orchestration run-create --objective "<objective>" --json` | Exact new Run and proven coordinator binding |
| Bind existing Run | `orca-ide orchestration run-use --id <run-id> --json` | Current coordinator is accepted; no takeover flag |
| Create Task | `orca-ide orchestration task-create --run <run-id> --spec "<brief>" --json` | Exact Task ID |
| Start isolated Pi worker | `orca-ide orchestration worker-start --run <run-id> --task <task-id> --worktree new-top-level --repo <exact-selector> --base-branch <selected-ref> --name <name> --agent pi --setup run --json` | `ready` receipt with exact Dispatch/worktree/terminal and setup state |
| Inspect tasks | `orca-ide orchestration task-list --run <run-id> --brief --json` | Authoritative current Task states |
| Inspect worker | `orca-ide orchestration worker-show --dispatch <dispatch-id> --json` | Current lifecycle/resource state |
| Await delivery | `orca-ide orchestration check --run <run-id> --wait --types worker_done,escalation,question --timeout-ms 30000 --json` | Bounded Delivery, or explicit empty timeout |
| Reply | `orca-ide orchestration reply --id <message-id> --body "<answer>" --json` | Reply receipt for the exact pending question |
| Acknowledge | `orca-ide orchestration check --run <run-id> --ack <delivery-id> --json` | Prior batch acknowledged; any next batch must also be retained |
| Worker cleanup | `orca-ide orchestration worker-release --dispatch <dispatch-id> --json` | Exact settled owned terminal released, or explicit retention/recovery state |
| Explicit stop | `orca-ide orchestration worker-stop --dispatch <dispatch-id> --json` | Runtime-confirmed outcome; worktree remains intact |
| Existing Taskdesk isolation test | `bun test test/pi.test.ts` | Pass; no personal resources discovered |
| Existing Taskdesk gates | `bun run check && bun test` | Exit 0; report actual results |

**Known Pi launch limitation:** `worker-start --model` currently supports Claude, Codex, and Cursor, not Pi. V1 uses the configured Pi launcher/model; verify and report the actual selection. Do not pass unsupported Pi model/effort flags or silently switch providers. If exact Pi launch arguments are required for the isolated trial, configure a supported scoped Orca launcher after inspecting its version-matched controls. If no safe scoped configuration exists, STOP and ask; do not invent a launcher API or change global defaults behind the user.

The new repository must define `check` as strict `tsc --noEmit` and use `bun test`. These are **planned commands**, not existing or already-passing checks. First dependency resolution creates the new lockfile; subsequent installs use `bun install --frozen-lockfile`. Pi host packages and TypeBox belong in peer dependencies with compatible development versions for tests/typechecking, not bundled replacement Pi runtimes. No new production dependency should be necessary beyond host peers.

## Git and integration workflow

- This plan is stored in Taskdesk only to preserve the design record; extension code belongs in the separate repository.
- Bootstrap an empty local repository when execution is authorized; no remote creation or publication. Record its baseline commit before creating implementation worktrees.
- Use Orca for managed worktrees, not raw `git worktree` commands. Choose the Git base explicitly and separately from Orca parent/child lineage.
- Suggested implementation branch: `feat/orca-bridge`. Commit focused units in the executor checkout when authorized, using descriptive imperative messages.
- Do not split the tiny bridge across concurrent writers initially. After freezing the CLI fixtures and delivery contract, a read-only reviewer can work independently; overlap does not justify extra writer lanes.
- Test the *user's intended parallel workflow* with two separate smoke workers, not by having them both implement this bridge.
- Keep uncommitted plans available by inlining their text in task briefs; new worktrees only contain committed files. Never assume the untracked improve skill or this plan is present in a worker checkout.

## Steps

### Step 1 — Prove native Orca coordination and capture the exact contract

Before implementing a wrapper, establish a fresh, disposable smoke repository and an identifiable coordinator Pi terminal in Orca. Do not bind unrelated Runs or impersonate another terminal with `--from`. An available Orca CLI and a recognized cwd alone do not prove coordinator identity.

Read `status`, the two live skills, and command help. Create one new Run and two independent Tasks. Launch two Pi workers in distinct new top-level worktrees from the same recorded baseline. Each brief must forbid application data access, recursive spawning, publication, and use of `pi-subagents`/`pi-intercom`.

- Worker A asks a deliberately bounded question such as which of two fixture headings to use, then waits for the reply and writes only its assigned fixture.
- Worker B writes a different fixture and reports its result. It must be launched before the coordinator starts waiting on A, proving overlapping worker lifetimes.
- Both report `worker_done` using their injected Task/Dispatch identity and explicit outcome.
- The coordinator processes the entire FIFO Delivery, replies by exact message ID, and releases settled worker terminals before acknowledgement unless explicitly retained by the user. Keep worktrees and reports for inspection.

Native manual `check --wait` is sufficient for this step. Do not claim automatic Pi wakeup yet. Real model calls require explicit execution-stage approval; this planning request alone does not run them. Confirm two short calls, selected models, and no open-ended retry permission before starting the live gate.

Capture minimal sanitized response fixtures for ready, empty timeout, Delivery with multiple messages, reply, acknowledgement returning another Delivery, cleanup, and failed/unknown start. Do not force destructive real failures to obtain fixtures; synthetic variants may supplement observed successful envelopes and must be labeled synthetic. Store shapes under `test/fixtures/` and evidence in `docs/live-verification.md` after bootstrap.

**Verify:** `task-list --run <new-run> --json`, `dispatch-show --task <each-task> --json`, and `worker-show --dispatch <each-dispatch> --json` show two distinct attempts/worktrees; the question received the intended reply; both final outcomes and terminal release decisions are recorded. If Orca's experimental API or Pi-terminal identity fails, STOP here.

### Step 2 — Bootstrap the small package and bounded CLI execution

Create the scoped files above. Package manifest exposes one extension and one workflow skill. Do not auto-load the improve skill into writing workers.

Implement one CLI execution function using a fixed executable and argument arrays, never a shell command assembled from task text. Execute with an explicit cwd and inherited trusted Orca launch context, but do not log environment values. Validate `ok`, the expected result shape, and exit status; preserve failed/unknown mutation receipts and recovery references even on a nonzero exit. Do not flatten everything into a generic error.

Keep stdout separate from stderr: long waits emit keepalive JSON lines to **stderr**, not final response records. Bound raw capture and model-visible output. Use abort-aware Node process APIs when needed to bound streams and stop only the owned CLI child. An oversized or malformed response is an explicit error, not a truncated JSON object treated as success.

No automatic retries of `run-create`, `task-create`, `worker-start`, reply, or other mutations. A transport timeout may mean the operation happened. Surface the exact task/run/receipt and inspect or follow the runtime-issued recovery instruction. Do not guess a `--retry-request` value.

**Verify:** `bun run check` and `bun test test/orca.test.ts` exit 0. Tests prove task text containing quotes/newlines/shell metacharacters remains one argv value, wrong envelopes fail, stderr keepalives do not corrupt results, cancellation cleans up the CLI child, and failed/unknown receipts remain inspectable. No unit test requires Orca or provider credentials.

### Step 3 — Add explicit lead-session binding and two narrow tools

Use a small `/orca` command with `start <objective>`, `attach <run-id>`, `status`, `pause`, `resume`, and `limit <positive-integer>` subcommands. These are **new extension commands**, not claims about Orca CLI syntax.

- Start/attach is explicit. Persist the Run ID, owning Pi session ID, exact repo/cwd, resolved CLI executable, and concurrency ceiling using `pi.appendEntry`.
- Default limit is four. Changing it is a user command, not an autonomous worker decision. It bounds launches by this bridge in this Run, not every agent on the machine.
- A Run is never automatically created on ordinary Pi startup. Explicitly refuse automatic ownership inheritance on `/new`, `/fork`, `/clone`, or a different session. A resumed session must revalidate the live Orca coordinator binding; losing ownership pauses mutations/delivery.
- Resolve repository identity from actual Orca metadata. Refuse cross-repo task/worktree targets in v1.
- Reject coordinator controls when running as an active worker; use Orca's real role/depth evidence, not invented environment variable names. Do not let creating a new Run bypass worker status.

Expose only these tools initially:

1. **`orca_delegate`**: bounded task title/specification, unique worktree name, and an explicit existing base ref. Requires a bound Run. Creates a Task and starts one local Pi worker in a new top-level worktree using the supported composition. Returns exact Task/Dispatch/worktree identities and setup state. No raw argv, `--from`, recursive launch, arbitrary cwd, model override, or auto-merge parameters.
2. **`orca_inbox`**: `pending`, `reply`, and `ack` operations for the current Run. Reply takes an exact pending question ID and answer. Ack takes the exact current Delivery ID, not a guessed timestamp or the newest message. Validate every target against the delivered batch/current Run.

Use the existing Orca CLI skill for worker inspection, guidance, explicit stopping, and release rather than wrapping its entire command surface. `orca_delegate` can be invoked concurrently, but admission must be serialized: reconcile authoritative active attempts, reserve in-flight launches before awaiting I/O, and count unknown outcomes as occupied until reconciled. Full capacity returns a clear refusal, not a hidden queue. A Task created before a failed launch remains visible and is not silently recreated.

**Verify:** `bun run check && bun test` exits 0. Tests cover no-binding refusal, wrong-Run replies, worker role refusal, dirty/untracked source not copied, exact base forwarding, four concurrent admissions and rejection of a fifth, unknown launch occupying its slot, and no unsupported `--model` for Pi. Treat these as cooperative guardrails, not a sandbox against arbitrary `bash` use.

### Step 4 — Bridge the durable Orca inbox into Pi without losing mail

Only the explicitly bound lead runs the inbox listener. Keep one abortable `check --wait` process per session, using finite rolling windows (e.g. 30 seconds) with no model turn for empty timeouts. Orca downtime or malformed authority pauses the listener with a visible diagnostic, not an uncontrolled restart loop or provider fallback. `resume` revalidates and restarts it.

Delivery contract:

1. Receive the current whole FIFO Delivery. Filters control wakeup, **not permission to discard other messages in that batch**.
2. Keep at most one unacknowledged batch active. Store delivery/message IDs and enough receipt context to recover, not a competing task database.
3. Inject an attributed custom message with `pi.sendMessage`, `display: true`, and `triggerTurn: true`. Do not use `sendUserMessage` to impersonate the human. Worker text is evidence and requests, not higher-priority instructions or authorization to expand scope.
4. Use safe queued delivery while the lead is busy; never abort its current tool or replace human input. Include exact reply/ack instructions and full accessible bounded text. If a batch exceeds the model-visible bound, provide a safe pagination path through `orca_inbox pending` and do not make unshown messages implicitly processed.
5. Stop fetching/announcing the same batch repeatedly while awaiting explicit acknowledgement. `pending` can redisplay it on request. Injection is **not** acknowledgement.
6. `reply` records a successful exact-question reply receipt. An unknown reply outcome remains unresolved until inspected; do not send a new question or pretend success.
7. Before `ack`, require pending questions to have a proven reply and settled workers to have an explicit cleanup decision (release, immediate reuse, or user-requested retain) verifiable through Orca. Other messages require the lead to account for them. An escalation is not permission to stop a healthy worker automatically.
8. A successful `check --ack` may return the next batch. Process/retain that result through the same path; never discard it as an acknowledgement-only response.

Prefer **at-least-once delivery with idempotent processing**, not an impossible exactly-once promise across two applications. On interruption between receive/persist/inject/ack, Orca's unacknowledged Delivery is the recovery authority. Replay it once with a clear replay label when necessary. Merely recording "injected" before Pi actually queues/persists a message must not cause a lost question after reload. Deduplicate routine wakeups by Delivery ID; do not suppress an unprocessed batch forever based only on an in-memory flag.

The listener and CLI processes must stop on `session_shutdown` (including reload/switch), and stale async completions must no-op using an instance generation/token. Persist only this session's binding and delivery checkpoints. `/tree` navigation pauses the bridge and requires explicit resume/reconciliation because rewinding conversation history does not rewind Orca side effects. Compaction must not erase pending obligations; recover them from Orca and extension state. No listener starts in the extension factory or package discovery.

**Verify:** `bun test test/inbox.test.ts test/lifecycle.test.ts` and `bun run check` exit 0. Tests cover each interruption window, a batch mixing question/completion/status, duplicate batch, next-batch return on ack, busy lead, empty timeout, large payload, wrong Run, reload, session replacement, tree navigation, and pause/resume. Confirm no orphaned wait subprocess and no automatic worker kill on shutdown.

### Step 5 — Document the improve → parallel workers → acceptance workflow

Write `skills/orca-development/SKILL.md` and the package README. Keep the installed Orca guide authoritative for command details; do not copy its entire API into a stale local manual.

Specify this sequence:

1. Lead uses `/skill:improve` (the actual Pi skill command), vets findings, and writes plans. Do not claim `/improve` exists unless an explicit alias/template is separately installed.
2. User selects work or explicitly authorizes a bounded set. The improve skill must not turn every suggestion into automatically executed work.
3. Lead partitions work by exclusive files/components and dependencies, supplies full task context, and launches ready Tasks up to the chosen ceiling. Branches use a recorded common base; dependent work waits for an accepted dependency or an explicitly selected stacked ref.
4. Each worker gets objective, repo/ref, owned files, prohibited files/data, success criteria, verification commands, expected report, and STOP/ask conditions. Writing workers do **not** load the read-only improve skill as their execution role.
5. Workers use Orca's injected `ask`/`worker_done` contract, not Intercom or guessed coordinator identities. They check structured inbox guidance at meaningful task boundaries. A follow-up `send` is mailbox delivery, not guaranteed immediate worker prompt injection.
6. Lead handles questions and completion deliveries. A worker report contains branch/base/commit or diff location, modified files, tests actually run, failures, and residual risks. Terminal idle or exit alone is not success.
7. Review accepted candidate diffs with fresh context where independence is useful; return revisions to the owning worker or a newly dispatched replacement. One integration worker combines approved changes only when authorized. Run all integration gates again.
8. Release exact settled owned agent terminals through Orca. Do not delete worktrees or setup/user terminals as cleanup. Failures are reported as failures, not hidden in a success subject.

Include a proposed narrow patch in `docs/improve-orca.patch` replacing the host-specific `general-purpose`/`isolation`/`sonnet` execution recipe with Orca dispatch and configured model selection, while preserving read-only advisor constraints. Do not apply it to owner files during package development. Document a short future `AGENTS.md` workflow paragraph and the decision needed about committing the untracked skill.

**Verify:** `bun run check && bun test` passes; review the skill against the installed guide. `rg -n 'pi-subagents|pi-intercom|general-purpose|sonnet' README.md skills docs` returns only intentional migration/history/patch-context mentions, not live execution requirements. Confirm every documented new tool/command exists in the package and all examples use runtime-issued IDs.

### Step 6 — Prove live Pi wakeups and isolated parallel editing

Run a dedicated Pi lead and two Pi workers in Orca using the new extension **without loading `pi-subagents` or `pi-intercom`**. A lead test invocation may use `pi --no-extensions -e /home/alex/Work/pi-orca/src/index.ts`; pass explicit skill paths as needed. Do not assume this flag also applies to Orca-launched workers. Inspect/configure the trial repository's supported Pi launcher, record its original state, and verify the workers' loaded tools. If this cannot be done safely, report the gate blocked rather than uninstalling globally to force the test.

Use a disposable fixture repository, not Taskdesk's real database. Obtain approval for the short provider-backed smoke run if not already granted. Verify:

- Two workers overlap and edit different files in different worktrees from the same base.
- Worker A's blocking question wakes an idle lead automatically; the lead's exact reply resumes A.
- Worker B completes while the lead is busy; completion appears without aborting work or dropping human input.
- Lead receives both results; command receipts and changes match reports. Accepted terminal cleanup precedes acknowledgement.
- Reload the lead while a question is pending. The question remains actionable, without a lost batch or a second duplicate worker.
- Pause/resume and, in a disposable lead session, session switching/tree navigation never steal Run ownership or acknowledge mail in the wrong session.
- Stop an explicitly selected third short smoke attempt while it is active. Observe the resulting state honestly; worktree files remain intact and unrelated terminals survive. This third attempt is optional until separately approved if it exceeds the smoke-call budget; it remains a pending acceptance criterion, not a fabricated pass.
- Verify an expected failed worker result stays failed and is delivered. It may be produced by a deliberately failing fixture check in an approved smoke attempt.

Record versions, selected models, Run/Task/Dispatch IDs, worktree paths/base refs, lifecycle receipts, exact test commands, and unverified cases in `docs/live-verification.md`. Redact secrets and unrelated task contents. Do not claim mocks prove real authentication, model selection, delivery, or TUI behavior.

**Verify:** `bun run check && bun test`; inspect `task-list`, `worker-show`, exact reply/ack/release receipts and fixture diffs. The evidence document must show all required live cases as PASS before recommending removal. Otherwise mark the plan BLOCKED or IN PROGRESS with the specific missing gate.

### Step 7 — Roll out reversibly, then retire the overlapping packages

Do this only after acceptance and explicit owner approval of the global impact. These are user packages used by other Pi sessions, not just Taskdesk dependencies.

1. Inventory active old-tool work. Let those sessions finish or obtain explicit instructions; do not interrupt them or kill the Intercom broker.
2. Back up the current Pi settings/package source list privately without copying credential files or printing secrets. Record how to restore just the affected entries.
3. Install the new local package with `pi install /home/alex/Work/pi-orca`. New sessions default to detached until the user starts/attaches an Orca Run.
4. Apply the reviewed narrow Taskdesk instructions/skill patch only after handling its existing untracked state deliberately. Do not commit unrelated `.agents` content or rewrite `skills-lock.json` with fabricated hashes. If the package's skill is sufficient, keep the patch minimal.
5. Disable the two old packages for the trial setup using Pi's supported resource filtering and reload/restart that dedicated session. Verify the new tools are loaded and the old tools are absent. Do not blindly overwrite the existing packages array.
6. After the successful disabled-package trial and explicit global removal approval, use the exact registered sources: `pi remove npm:pi-subagents` and `pi remove npm:pi-intercom`. Preserve `pi-web-access` and unrelated resources.
7. Restart/reload affected sessions deliberately and recheck inventory. Do not delete old sessions, run artifacts, or package data manually.
8. Document rollback: pause the new bridge, leave worker worktrees intact, reinstall the recorded old package versions (`npm:pi-subagents@0.71.0`, `npm:pi-intercom@0.14.0`, or the versions captured at rollout), and restore affected settings intentionally. Confirm version availability before depending on rollback. Rollback does not transfer an active Orca Dispatch into a pi-subagents run; reconcile the live work explicitly.

**Verify:** `pi list` shows the intended package set; a fresh Pi session proves actual tool loading; an approved short round trip still works after migration. In Taskdesk run `bun test test/pi.test.ts` and `bun run check && bun test`, with no real application server or provider-dependent generation. `git status --short` in both repositories must show only authorized changes plus the recorded pre-existing untracked files.

## Test plan summary

Permanent provider-free tests must cover:

- CLI argv safety, output bounds, exit/error envelopes, stderr keepalives, cancellation, receipt retention, and mutation uncertainty.
- Correct Run/session/repo ownership and no implicit takeover.
- Serialized concurrent admission and honest capacity after failed/unknown launches.
- Complete FIFO delivery processing, per-message addressing, pending questions, worker cleanup decisions, explicit acknowledgement, and next-batch handling.
- At-least-once replay, duplicate wakeup suppression, and every receive/persist/inject/ack interruption boundary.
- Session reload/switch/fork/tree behavior, compaction recovery, listener cleanup, stale async callbacks, busy/idle injection, and no provider calls for empty waits.
- Dependency-free unit execution with fake CLI fixtures; no Orca binary, credential, or network requirement for `bun test`.

Live tests are distinct: actual Orca ownership, Pi launches/model selection, isolated parallel editing, automatic wakeups, question/reply continuation, failure/stop, and restart recovery. Skipped live cases remain explicitly unverified.

## Done criteria

- [x] Native Orca smoke established the supported contract before wrapping it.
- [x] `bun install --frozen-lockfile`, `bun run check`, and `bun test` pass in the candidate checkout; parent reran check and all 24 tests.
- [x] Exactly one extension and one workflow skill are exposed; no separate service, broker, task database, custom Git lifecycle, or model backend was added.
- [ ] The real two-worker run plus required recovery/failure/stop cases pass with old extensions unloaded; receipts and diffs are recorded.
- [ ] Unknown outcomes, wrong identities, and missing authority fail visibly; they never create replacement workers automatically.
- [ ] Reload/shutdown leaves no owned inbox subprocess; workers and worktrees are not silently destroyed.
- [x] Improve remains advisory/read-only; writing and integration belong to explicit workers. Proposed adaptation is unapplied.
- [ ] Taskdesk's embedded Pi isolation regression and normal gates pass after any instruction rollout; no application runtime/data changes exist.
- [ ] Migration/rollback documentation identifies exact package sources, impact, and remaining live work.
- [x] Package removal is explicitly left pending; old packages and global settings are unchanged. Migration is not complete.
- [x] The advisor updated `plans/README.md` with evidence paths and the true state; no push, publication, or main-branch merge occurred.

## STOP conditions

Stop and report the precise command, result, cwd/repo/ref, and any created resources if:

- Orca's experimental API is unavailable or the actual coordinator/worker terminal identity cannot be proven.
- A necessary Pi launch/model/resource-isolation option is unsupported. Do not switch agent providers or execution protocols silently.
- A start returns failed/unknown or the connection drops after a mutation; inspect the existing attempt before retrying, and follow only documented exact recovery.
- A Run is owned by another live coordinator, inherited worker context is stale, or the proposed task targets unrelated state.
- Delivery acknowledgement or ownership semantics differ from this plan; reconcile the plan instead of creating a second broker/database.
- Reliable behavior appears to require implementing a scheduler, hidden automatic retries, terminal scraping for success, or a broad compatibility framework.
- Any step would touch Taskdesk's `.data`, application source, credentials, unrelated configuration, or untracked owner files outside the rollout boundary.
- A verification gate fails twice after focused fixes, or required live testing lacks provider-call approval.
- The proposed `pi-orca` path already contains unrelated work, or clean rollback cannot be demonstrated.

## Maintenance notes

The primary risk is Orca's evolving experimental CLI contract, not Pi tool registration. Keep response fixtures small and based on observed receipts; re-run the smoke gate after meaningful Orca/Pi updates. Check exact identities and failure outcomes in review. Keep workers' reports distinct from acceptance and cleanup distinct from deletion. Do not expand the extension merely to eliminate every CLI call: the existing Orca skill is deliberately part of the solution.

A future improvement may add better model selection or worker inbox wakeup if the owner demonstrates a need and the supported APIs make it simple. Neither justifies building it in v1.
