# Architecture hot-path execution and review

## Authority and scope

Owner: “implement them”, following the audit's recommendation to implement the first four improvements. Lead stated scope explicitly: plans 021–024, no static-asset caching or schema migrations. One separate Pi executor implements in an isolated checkout; advisor writes planning/review records only. No merge or push is authorized. Main checkout has the owner's active `bun --watch src/server.ts` server, so source edits there would restart it against live data. No agent may touch `.data` or that server/terminal. Untracked owner plans 012/013 stay untouched.

Baseline: `eb324c4e05ed73243dabc6242422baea4e855c67`; Bun 1.4.2 / SQLite 3.53.2; independent pre-implementation TypeScript and 128 tests pass. `bun audit --audit-level=high` reported no vulnerabilities across 238 packages during research. Research probes were synthetic/in-memory or owned temporary databases, with cleanup; no real provider calls or browser interaction.

## Placement and lifecycle

- Orca executable: managed `orca` CLI, runtime 1.4.192. Read current full CLI/orchestration guides before dispatch.
- Run: `run_6421011b6463`.
- Task: `task_be259898f62f`; includes complete plans 021–024, boundaries, verification commands and report requirements.
- Worktree: `/home/alex/orca/workspaces/GenUIExperiment/architecture-hot-paths`.
- Branch: `alexradunet/architecture-hot-paths`; top-level lineage, default origin/master base verified at `eb324c4`.
- Single Pi terminal: `term_0fabd982-5563-4142-9210-150dee2ebf1b`.
- Active dispatch: `ctx_a5348d47494d` — ready/input_accepted, task status dispatched independently verified.
- Setup skipped intentionally: configured hook is `npm install`, contrary to project's Bun lockfile requirement. Executor installs only `bun install --frozen-lockfile` as necessary.

Initial composed start `ctx_f3d39d2f67f3` created the worktree/Pi terminal but failed at dispatch input (`agent_prompt_stalled`). Lead inspected worker-show, full short terminal output, git status and exact HEAD: no task text or edits had run. Native terminal wait confirmed tui-idle. A retry with terminal alone failed validation (`terminal_worktree_mismatch`) because implicit placement was main; it did not create another worker. Explicit existing-worktree + exact-terminal + retry-of succeeded under `ctx_a5348d47494d`. No duplicate editor or new session was launched. The existing terminal remains the sole writer and cleanup ownership is transferred by Orca.

## Review gates

Initial implementation completed at `d3557c3` through commits `2965613`, `21f2bf7`, `9edd254`, `d3557c3`. Lead read the full source/docs/test diff and worker report, independently passed strict TypeScript, all 132 tests, diff hygiene and clean isolated status. No demonstrated implementation bug was found, but required regression coverage had gaps. [Review 1](021-024-review-1.md) requests true multi-reference action scope negatives, mixed-filter/multi-source placeholder tests, parse/type-read operation counts, complete rollback history/edge assertions, and actual candidate full counts/index evidence.

The same exact Pi terminal was immediately reused for Task `task_1adcf0f2bd77` / Dispatch `ctx_25a641202403`; input accepted. This transfers cleanup ownership without another writer. Completion Delivery `delivery_a0f6ab8a77dd` was fully read and acknowledged only after the follow-up owner was established. Production changes are frozen for the verification-focused follow-up unless a test exposes a real defect and coordinator approves a narrow repair. This is repair round 1 of at most 2.

**Final: APPROVE `c737ec82e357c09a019e21174c257cf0d432e9f2`.** Follow-up commit strengthens tests and benchmark count/index evidence only; production source remains identical to `d3557c3`. Lead read every follow-up hunk and independently reran strict TypeScript, all 134 tests, baseline diff hygiene, default sqlite:bench and direct summary-read/Markdown-parse/HTTP operation probes. See [accepted review](021-024-accepted-review.md) for precise results and limits. Original main source remains `eb324c4`; isolated worktree is clean. No merge/push occurred.

Review Task `task_1adcf0f2bd77` / Dispatch `ctx_25a641202403` completed; final Delivery `delivery_de7a55762ca8` was fully read and acknowledged after native worker-release. Cleanup returned `release_unknown` / `tab_not_found`; worker-show confirms the exact terminal exited, disconnected and unwritable, with terminal output archived. Prescribed retry request `f47e4f3e-7082-4d5f-9eb5-0761befea7c8` replayed the same unresolved metadata. No broad close/reset/deletion attempted. All Tasks are settled, no actionable mail remains, and no implementation worker is active. The cleanup metadata limitation does not mark code verification failed; it remains explicitly recorded rather than claiming a successful release receipt.
