# Markdown vault quick start

The application now activates explicitly approved definitions and safely writes real Markdown records. The CLI remains read-only.

## Open Today

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000/today**. First startup copies the fictional sample into `.data/vault`; source examples and personal data are untouched. To choose your own vault explicitly:

```sh
VAULT_ROOT=/absolute/path/to/vault PI_MODEL=openai-codex/gpt-5.5 npm start
```

1. Open **App review**, inspect the exact definition source, select permissions, and approve. Approve Wiki, Tasks, Calendar and Journal for the connected sample. Read and create/update permissions are separate; ordinary PARA notes additionally need Wiki's `notes:read`.
2. Return to Today. Its conversation and layout have a persistent workspace URL.
3. Say **“Create a task to finish the homepage tomorrow.”** Demo supports this grammar without credentials. Select Pi for open-ended requests; choose a model supported by your account through `PI_MODEL`.
4. Open the task to schedule a timed session using Start, End and an explicit IANA timezone. A deadline can also be changed through **Set a date** on Today. Calendar → Tomorrow shows the projections without creating duplicate event files.
5. Complete the task. Add its `[[vault/relative/path]]` to the free-form journal, or ask Pi to link the completed task while preserving existing writing. **Link in journal** on unfinished tasks inserts a draft link; saving is explicit.
6. Refresh or restart. Records, grants, receipts and conversation persist. Opening Today never creates a journal automatically.

Keep backups of the whole vault, including `.lifeapps/runtime.json`, plus `.data/state.json` for conversations. The vault is shared across local browser sessions. Use one app server per vault. External record changes are picked up on the next read and stale forms are rejected; external definition changes suspend the affected app until reapproved. Invalid readable records are omitted from actions and reported in Today's validation notice.

Writes are bounded, revision-checked and journaled, but this is not a sandbox against a hostile concurrent filesystem writer. There is no migration engine or conversational app builder yet.

## Check the sample

From the repository root, after installing project dependencies:

```sh
bun scripts/lifeapps.ts check examples/life-vault
```

Or, using the project's existing Node setup:

```sh
npm run lifeapps -- check examples/life-vault
```

Expected: **13 Markdown files, four valid app candidates, no errors or warnings**.

## Machine-readable report

```sh
bun scripts/lifeapps.ts check examples/life-vault --json
```

For clean JSON under Node, bypass the package runner's banner:

```sh
node --import tsx scripts/lifeapps.ts check examples/life-vault --json
```

Exit codes: **0** valid (warnings allowed), **1** validation errors, **2** incorrect usage/internal failure. Invalid or missing vault paths return validation errors, not successful empty reports.

## Inspect the contract

```sh
bun scripts/lifeapps.ts schema
bun scripts/lifeapps.ts --help
```

The schema command exports JSON Schema for definition shape checks. The shared validator adds semantic checks such as unknown fields, calendar mappings, valid dates, duplicate IDs and journal dates, and typed-reference integrity.

## Experiment safely

Copy `examples/life-vault/` somewhere disposable, preserving the hidden `.apps/` directory. Change a task's status to `finished` or its deadline to `2026-02-30`, then check that copy. The report identifies the file, field and source location. Checking never changes the file.

You do not need to connect your real LifeOS data. All sample content is fictional.

For the exact supported grammar, safety limits and deferred features, see [the app-definition contract](app-definition-v1.md).
