# Vault validator quick start

This milestone reads Markdown files and checks app definitions, records and relationships. It does not install apps, repair files, call Pi or change the current Taskdesk UI.

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
